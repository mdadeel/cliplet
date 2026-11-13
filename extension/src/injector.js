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

const FOCUS_DELAY_MS = 250;          // grace after the grab is released
const FOCUS_RETRIES_MS = [250, 550, 850]; // focus restore can lag the grab release
const MODIFIER_RELEASE_CAP_MS = 600; // S28: never wait longer than this

export class Injector {
    constructor({ capture, onFallback }) {
        this._capture = capture;
        this._onFallback = onFallback;   // (message) => quiet notification
        this._device = null;
        this._pendingId = 0;
    }

    enable() {
        // Mutter 18: the seat lives on the Clutter backend (Meta.Backend no
        // longer proxies it). get_default_backend() returns the shell's own.
        this._device = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    disable() {
        if (this._pendingId) {
            GLib.source_remove(this._pendingId);
            this._pendingId = 0;
        }
        this._device = null;
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

    // Put the entry on the clipboard and inject the paste chord into the
    // recorded target. The guard runs at the last possible moment — and
    // tolerates a lagging focus restore: window managers do not always
    // refocus within the first grace window after a modal grab releases,
    // so give it a few chances before refusing (still never typing into
    // the wrong window).
    paste(entry, recorded) {
        const isImage = entry.kind === 'image';
        if (!this._device || !recorded || !recorded.hasWindow) {
            this._capture.markInternalSet();
            this._setClipboard(entry);
            this._onFallback('Copied — no focused window to paste into.');
            return;
        }
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
