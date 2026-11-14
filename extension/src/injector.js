// Paste/insert service (§04 Q3, DR-09). The focus-target guard is the
// non-negotiable safety rule: if the window that has focus at inject time is
// not the window that had focus when the popup opened, Cliplet refuses to
// inject, leaves the content on the clipboard, and says so once (R6/R2).
//
// The injector runs entirely inside the shell — the only place a virtual
// keyboard exists on Mutter (no data-control, no external injection).

import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { perf } from './perf.js';

// Chord keyvals. notify_keyval (not notify_key/evdev): the evdev path
// reaches mutter's own keybindings but demonstrably never arrives at
// Wayland clients on this build — the paste lands only via keyvals.
const KEY_LEFTCTRL = Clutter.KEY_Control_L;
const KEY_LEFTSHIFT = Clutter.KEY_Shift_L;
const KEY_V = Clutter.KEY_v;
const KEY_INSERT = Clutter.KEY_Insert;

const TERMINAL_HINTS = [
    'gnome-terminal', 'kgx', 'console', 'ptyxis', 'konsole', 'alacritty',
    'kitty', 'xterm', 'foot', 'wezterm', 'ghostty', 'urxvt', 'termite',
    'terminator', 'tilix', 'guake', 'st-256color',
];

const FOCUS_RETRIES_MS = [250, 550, 850]; // focus restore can lag the grab release
const MODIFIER_RELEASE_CAP_MS = 600; // S28: never wait longer than this

// Text delivery, fast path. GNOME's own emoji picker commits through the
// shell input method (js/ui/keyboard.js -> Main.inputMethod.commit): the
// glyph lands in the focused client on the next frame and the clipboard is
// never touched. Cliplet's chord path instead waits a fixed 250 ms grace
// after the modal grab releases before it injects Ctrl+V — that constant is
// most of the "the emoji appears slowly" gap against Windows and macOS, both
// of which commit text directly. Poll one frame at a time for text focus to
// come back, then commit; apps with no text-input support (X11 clients, and
// Wayland apps without text-input-v3/IBus) fall through to the chord path.
const IM_POLL_MS = 16;
const IM_BUDGET_MS = 180;

export class Injector {
    constructor({ capture, onFallback }) {
        this._capture = capture;
        this._onFallback = onFallback;   // (message) => quiet notification
        this._device = null;
        this._pendingId = 0;
        this._imId = 0;
    }

    enable() {
        // Mutter 18: the seat lives on the Clutter backend (Meta.Backend no
        // longer proxies it). get_default_backend() returns the shell's own.
        this._device = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    disable() {
        this._cancelPending();
        this._device = null;
    }

    // A superseded delivery must never fire: the old code overwrote
    // `_pendingId` without removing the previous source, so two inserts
    // inside the focus grace window injected two chords (and the second one
    // pasted whatever the first had left on the clipboard).
    _cancelPending() {
        if (this._pendingId) {
            GLib.source_remove(this._pendingId);
            this._pendingId = 0;
        }
        if (this._imId) {
            GLib.source_remove(this._imId);
            this._imId = 0;
        }
    }

    // Snapshot of the target the popup promises to deliver to.
    recordFocus() {
        try {
            const win = global.display.focus_window;
            if (!win) return { hasWindow: false, seq: -1, wmClass: '', appId: '' };
            const tracker = Shell.WindowTracker.get_default();
            const app = tracker.get_window_app(win);
            return {
                hasWindow: true,
                seq: win.get_stable_sequence(),
                wmClass: win.get_wm_class() || '',
                appId: app ? (app.get_id() || '') : '',
            };
        } catch {
            return { hasWindow: false, seq: -1, wmClass: '', appId: '' };
        }
    }

    focusMatches(recorded) {
        try {
            const win = global.display.focus_window;
            if (!recorded || !recorded.hasWindow) return false;
            return !!win && win.get_stable_sequence() === recorded.seq;
        } catch {
            return false;
        }
    }

    isTerminalTarget(recorded) {
        const hay = `${recorded?.wmClass || ''} ${recorded?.appId || ''}`.toLowerCase();
        return TERMINAL_HINTS.some((t) => hay.includes(t));
    }

    // Deliver an entry to the window that had focus when the popup opened.
    // Text goes out through the input method when one is available (fast,
    // clipboard untouched); everything else — images, and apps with no
    // text-input support — goes out as clipboard + an injected chord.
    paste(entry, recorded) {
        const isImage = entry.kind === 'image';
        perf.start('insert');
        this._cancelPending();
        if (!this._device || !recorded || !recorded.hasWindow) {
            this._capture.markInternalSet();
            this._setClipboard(entry);
            this._onFallback('Copied — no focused window to paste into.');
            return;
        }
        if (!isImage && this._commitViaInputMethod(entry.text, recorded))
            return;
        this._pasteViaChord(entry, recorded);
    }

    // Fast path: commit the text through the shell's input method. Returns
    // true when it owns delivery (including the bounded poll that decides),
    // false when this shell/app has no input method to commit through.
    _commitViaInputMethod(text, recorded) {
        const im = Main.inputMethod;
        if (!im || typeof im.commit !== 'function')
            return false;

        const deadline = GLib.get_monotonic_time() + (IM_BUDGET_MS * 1000);
        this._imId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IM_POLL_MS, () => {
            if (this._imFocusReady(im, recorded)) {
                this._imId = 0;
                im.commit(text);          // no clipboard write, no chord
                perf.end('insert', 'path=input-method');
                return GLib.SOURCE_REMOVE;
            }
            if (GLib.get_monotonic_time() >= deadline) {
                this._imId = 0;
                this._pasteViaChord({ kind: 'text', text }, recorded);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_KEEP;
        });
        return true;
    }

    // Commit only once text focus is back on the recorded window: while our
    // own search entry still owns it, a commit would type the glyph into the
    // (already hidden) popup instead of the user's document.
    _imFocusReady(im, recorded) {
        if (!im.currentFocus) return false;          // no text-input client
        if (global.stage.key_focus) return false;    // a shell actor has keys
        return this.focusMatches(recorded);
    }

    // Fallback path: put the entry on the clipboard and inject the paste
    // chord into the recorded target. The guard runs at the last possible
    // moment — and tolerates a lagging focus restore: window managers do not
    // always refocus within the first grace window after a modal grab
    // releases, so give it a few chances before refusing (still never typing
    // into the wrong window).
    _pasteViaChord(entry, recorded) {
        const isImage = entry.kind === 'image';
        this._capture.markInternalSet();
        this._setClipboard(entry);

        // terminals have no image paste; the chord is still Ctrl+V there,
        // which is why image entries are offered as image/png content — apps
        // that cannot paste images simply ignore the chord.
        const chord = (!isImage && this.isTerminalTarget(recorded))
            ? [KEY_LEFTCTRL, KEY_LEFTSHIFT, KEY_V]
            : [KEY_LEFTCTRL, KEY_V];

        const attempt = (i) => {
            // Late guard (R6): refuse rather than type into the wrong window.
            if (this.focusMatches(recorded)) {
                this._pendingId = 0;
                this._inject(chord);
                perf.end('insert', 'path=clipboard+chord');
                return;
            }
            if (i + 1 < FOCUS_RETRIES_MS.length) {
                this._pendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                    FOCUS_RETRIES_MS[i + 1] - FOCUS_RETRIES_MS[i], () => {
                        attempt(i + 1);
                        return GLib.SOURCE_REMOVE;
                    });
                return;
            }
            this._pendingId = 0;
            // Content stays on the clipboard; the entry survives.
            this._onFallback('Copied — the paste target changed while the popup was open.');
        };
        this._pendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FOCUS_RETRIES_MS[0], () => {
            attempt(0);
            return GLib.SOURCE_REMOVE;
        });
    }

    // Text entries go out as text; image entries as their captured mime
    // (typically image/png) via the clipboard content path. Both take ONE
    // mimetype string (introspection), not an array.
    _setClipboard(entry) {
        if (entry.kind === 'image') {
            St.Clipboard.get_default()
                .set_content(St.ClipboardType.CLIPBOARD, entry.mime, entry.bytes);
        } else {
            St.Clipboard.get_default()
                .set_text(St.ClipboardType.CLIPBOARD, entry.text);
        }
    }

    _inject(keycodes) {
        const device = this._device;
        if (!device) return;
        const press = Clutter.KeyState.PRESSED;
        const release = Clutter.KeyState.RELEASED;
        // notify_keyval takes MICROseconds (introspection: time_us). The
        // current event time (ms × 1000) is what proven implementations use;
        // fall back to the monotonic clock outside an event context.
        const t = Math.floor(Clutter.get_current_event_time() * 1000) ||
            GLib.get_monotonic_time();
        for (const k of keycodes) {
            device.notify_keyval(t, k, press);
        }
        for (let i = keycodes.length - 1; i >= 0; i--) {
            device.notify_keyval(t + 10, keycodes[i], release);
        }
    }
}

export { MODIFIER_RELEASE_CAP_MS };
