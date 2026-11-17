// The capture spine. The one rule (docs/05 P1): the owner-changed handler only
// schedules deferred work — no I/O, no decode, no loops beyond the gate checks.
//
// Privacy rules (docs/06 §6.3):
//  1. MIME targets are inspected BEFORE any content read.
//  2. Offers marked x-kde-passwordManagerHint are never read.
//  3. The hint-less re-offer Mutter emits when the copying app exits is
//     suppressed by source-type + a 30s post-hint window. Reading the re-offer
//     to hash it is deliberately NOT done — rule 1 wins over rule 3's wording.
//  4. Heuristic secret shapes are captured but rendered masked.
//
// Images are D4-deferred in this review build: image-only offers are logged,
// not captured, and never create rows.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEBOUNCE_MS = 100;        // spec: 80–120 ms
const READ_TIMEOUT_S = 5;       // P8: one slow caller loses one entry, never the session
const REOFFER_WINDOW_S = 30;

const HINT_MIME = 'x-kde-passwordManagerHint';

const SECRET_PATTERNS = [
    /^-----BEGIN [A-Z ]*PRIVATE KEY/,
    /^eyJ[\w-]+\.[\w-]+\./,                        // JWT
    /^(AKIA|ASIA)[0-9A-Z]{16}$/,                   // AWS access key
    /^gh[pousr]_[A-Za-z0-9]{36,}$/,                // GitHub tokens
    /^sk-[A-Za-z0-9_-]{20,}$/,                     // OpenAI-style keys
    /^xox[baprs]-/,                                // Slack tokens
    /^[A-Za-z0-9+/=_-]{40,}$/,                     // opaque long token
];

export class ClipboardCapture {
    constructor({ settings, store, onChanged, multicopy = null }) {
        this._settings = settings;
        this._store = store;
        this._onChanged = onChanged;   // callback(entry|null) -> popup refresh / nothing
        this._multicopy = multicopy;   // {collecting, queue} — MultiCopy state (docs/15 §2.2)

        this._selection = null;
        this._ownerChangedId = 0;
        this._debounceId = 0;
        this._inFlight = false;
        this._pendingAfterFlight = false;
        this._pendingImageMimes = null;
        this._readDeadlineId = 0;

        this._lastHintedAt = 0;        // monotonic seconds
        this._capturedSinceHint = false;
        this._suppressOwnSet = false;  // our own clipboard writes must not re-capture
        this._logged = new Set();      // one log line per failure class (R14)
    }

    enable() {
        this._selection = global.display.get_selection();
        // P2: never observe before startup-complete — the connection itself is
        // cheap, but a capture storm at login must not queue reads. The guard
        // lives in _process().
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete',
                () => this._connectSelection());
        } else {
            this._connectSelection();
        }
    }

    _connectSelection() {
        if (this._ownerChangedId) return;
        // Empirically verified on mutter 18 (headless harness): the signal
        // carries (type, newOwner, oldOwner).
        this._ownerChangedId = this._selection.connect('owner-changed',
            (selection, type, newOwner, oldOwner) => this._onOwnerChanged(type, newOwner));
    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        if (this._ownerChangedId) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = 0;
        }
        this._selection = null;
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        this._cancelReadDeadline();
        this._inFlight = false;
        this._pendingAfterFlight = false;
        this._pendingImageMimes = null;
        this._logged.clear();
    }

    _onOwnerChanged(type, newOwner) {
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
        if (this._settings.get_boolean('pause-capture')) return;

        this._currentApp = this._sourceAppName();
        this._currentId = this._sourceAppId();

        // Coalesce: reset the debounce window instead of queueing (§05 P1).
        if (this._debounceId) GLib.source_remove(this._debounceId);
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this._process(newOwner);
            return GLib.SOURCE_REMOVE;
        });
    }

    _process(newOwner) {
        if (Main.layoutManager._startingUp ?? false) return;   // P2
        if (!this._selection) return;

        const mimes = this._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
        if (!mimes || mimes.length === 0) return;     // clipboard cleared — nothing to do

        // The own-set flag is consumed by the first offer after it, whatever
        // that offer turns out to be — it must never leak onto a later copy.
        const wasOwnSet = this._suppressOwnSet;
        this._suppressOwnSet = false;

        const now = GLib.get_monotonic_time() / GLib.USEC_PER_SEC;
        const sensitive = mimes.includes(HINT_MIME);
        const visibleMimes = mimes.filter((m) => m !== HINT_MIME).sort();

        if (sensitive) {
            this._lastHintedAt = now;
            this._capturedSinceHint = false;
            this._logOnce('hint', 'sensitive offer detected — not read');
            return;
        }

        // The hint-less re-offer: emitted by mutter when the copying app exits.
        // Heuristic, and honest about it: a memory-resident source (not a live
        // Wayland/X11 client source) shortly after a hinted skip, with nothing
        // legitimately captured in between, is treated as the re-offer.
        const isMemorySource = this._isMemorySource(newOwner);
        const inWindow = (now - this._lastHintedAt) < REOFFER_WINDOW_S;
        if (!wasOwnSet && !this._capturedSinceHint && inWindow && isMemorySource) {
            this._logOnce('reoffer', 'hint-less re-offer suppressed');
            return;
        }
        if (wasOwnSet) return;   // our own paste-path write — never history

        const imageOnly = visibleMimes.some((m) => m.startsWith('image/'));
        const hasText = visibleMimes.some((m) => m.startsWith('text/') || m === 'UTF8_STRING' ||
            m === 'STRING' || m === 'TEXT' || m === 'COMPOUND_TEXT' ||
            m === 'text/uri-list' || m === 'x-special/gnome-copied-files');

        if (!hasText) {
            if (imageOnly && this._settings.get_boolean('enable-image-capture')) {
                this._readImage(visibleMimes.filter((m) => m.startsWith('image/')));
            } else if (imageOnly) {
                this._logOnce('image', 'image offer — capture disabled (enable in Preferences)');
            }
            return;
        }

        this._readText();
    }

    _isMemorySource(owner) {
        if (!owner) return true;   // cleared/absent owner with mimetypes present: re-offer case
        try {
            const name = owner.constructor?.$gtype?.name || '';
            // Wayland/X11 client sources are named; unknown/base classes are
            // treated as compositor-internal (conservative).
            if (name === 'MetaSelectionSourceMemory') return true;
            if (name === 'MetaSelectionSourceWayland' || name === 'MetaSelectionSourceX11') return false;
            return name === 'MetaSelectionSource' || name === 'GObject_Object';
        } catch {
            return false;
        }
    }

    _readText() {
        if (this._inFlight) {
            this._pendingAfterFlight = true;
            this._pendingImageMimes = null;
            return;
        }
        this._inFlight = true;
        this._readTimedOut = false;
        const clipboard = St.Clipboard.get_default();
        clipboard.get_text(St.ClipboardType.CLIPBOARD, (clip, text) => {
            this._cancelReadDeadline();
            this._inFlight = false;
            if (this._readTimedOut) return;   // P8: deadline already dropped this read
            try {
                this._onText(text);
            } finally {
                this._resumeAfterFlight();
            }
        });
        this._readDeadlineId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, READ_TIMEOUT_S, () => {
            // P8: the callback lost its race with the timeout — drop this read.
            this._readDeadlineId = 0;
            this._inFlight = false;
            this._pendingAfterFlight = false;
            this._readTimedOut = true;
            this._logOnce('timeout', 'clipboard read timed out — entry dropped');
            return GLib.SOURCE_REMOVE;
        });
    }

    // Image offers (docs/15 §2.3): read the raw bytes through St.Clipboard's
    // content path. Memory-only, 8 MB cap; decode happens lazily in the row.
    // One read at a time; a newer offer queues behind the flight and the
    // resumption must remember WHICH kind of read is pending — an image
    // offer queued behind a text read must not resume as a text read.
    _resumeAfterFlight() {
        if (!this._pendingAfterFlight) return;
        this._pendingAfterFlight = false;
        if (this._pendingImageMimes) {
            this._readImage(this._pendingImageMimes);
        } else {
            this._readText();
        }
    }

    _readImage(mimes) {
        if (this._inFlight) {
            this._pendingAfterFlight = true;
            this._pendingImageMimes = mimes;
            return;
        }
        this._inFlight = true;
        // Read through mutter's selection transfer — St.Clipboard's content
        // callback hands back a GLib.Bytes with broken ownership (get_size()
        // reads garbage), so the St path is unusable for anything but text.
        const selection = global.display.get_selection();
        const output = Gio.MemoryOutputStream.new_resizable();
        selection.transfer_async(Meta.SelectionType.SELECTION_CLIPBOARD, mimes[0],
            8 * 1024 * 1024, output, null, (sel, res) => {
                this._cancelReadDeadline();
                this._inFlight = false;
                try {
                    sel.transfer_finish(res);
                    output.close(null);
                    const bytes = output.steal_as_bytes();
                    this._onImage(bytes, mimes);
                } catch (e) {
                    this._logOnce('imgread', `image read failed: ${e.message}`);
                } finally {
                    this._resumeAfterFlight();
                }
            });
        this._readDeadlineId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, READ_TIMEOUT_S, () => {
            this._readDeadlineId = 0;
            this._inFlight = false;
            this._pendingAfterFlight = false;
            this._logOnce('timeout', 'image read timed out — entry dropped');
            return GLib.SOURCE_REMOVE;
        });
    }

    _onImage(bytes, mimes) {
        const size = bytes?.get_size?.() ?? bytes?.length ?? 0;
        if (!bytes || size === 0) return;
        if (size > 8 * 1024 * 1024) {
            this._logOnce('imgbig', 'image over 8 MB — dropped');
            return;
        }
        if (this._suppressOwnSet) {
            this._suppressOwnSet = false;
            return;
        }
        const app = this._currentApp || this._sourceAppName();
        const appId = this._currentId || this._sourceAppId();
        if (this._isExcluded(app, appId)) {
            this._capturedSinceHint = true;
            return;
        }
        const mime = mimes.find((m) => m.startsWith('image/')) || 'image/png';

        if (this._multicopy && this._multicopy.collecting) {
            const nextId = (this._store?._nextId) ? this._store._nextId++ : Date.now();
            this._multicopy.queue.push({ _id: nextId, text: '', app, time: Date.now(), masked: false, truncated: false, kind: 'image', bytes, mime });
            this._capturedSinceHint = true;
            this._onChanged(null);
            return;
        }

        const entry = this._store.add({
            text: '',
            app,
            time: Date.now(),
            kind: 'image',
            bytes,
            mime,
        });
        this._capturedSinceHint = true;
        this._onChanged(entry);
    }

    _cancelReadDeadline() {
        if (this._readDeadlineId) {
            GLib.source_remove(this._readDeadlineId);
            this._readDeadlineId = 0;
        }
    }

    _onText(text) {
        if (text === null || text === undefined || text.length === 0) return;

        const app = this._currentApp || this._sourceAppName();
        const appId = this._currentId || this._sourceAppId();

        // App exclusions (docs/15 §1.3, hardened §2.6): matched against the
        // app NAME and its desktop app-ID — before anything touches the text.
        if (this._isExcluded(app, appId)) {
            this._capturedSinceHint = true;
            return;
        }

        const cap = this._settings.get_int('text-cap-kb') * 1024;
        let truncated = false;
        if (text.length > cap) {
            let end = cap;
            if (end > 0 && end < text.length) {
                const code = text.charCodeAt(end - 1);
                if (code >= 0xD800 && code <= 0xDBFF) {
                    end--; // don't split surrogate pair
                }
            }
            text = text.slice(0, end);
            truncated = true;
        }

        // Our own paste-path writes must not enter history.
        if (this._suppressOwnSet) {
            this._suppressOwnSet = false;
            return;
        }

        // File copies (Nautilus & friends): uri lists arrive through the
        // text read, either prefixed with the gnome-copied-files marker or
        // as bare file:// URIs. Normalized to one URI per line.
        let kind = null;
        if (/^x-special\/gnome-copied-files/.test(text)) {
            text = text.replace(/^x-special\/gnome-copied-files\n?/, '')
                .replace(/^(copy|cut|link)\n?/, '')
                .split('\0').filter(Boolean).join('\n');
            kind = 'files';
        } else if (/^file:\/\//m.test(text)) {
            kind = 'files';
        }

        const masked = SECRET_PATTERNS.some((re) => re.test(text));

        // MultiCopy: while collecting, copies join the queue instead of the
        // history. The queue is merged on stop or pasted as one joined text.
        if (this._multicopy && this._multicopy.collecting) {
            const nextId = (this._store?._nextId) ? this._store._nextId++ : Date.now();
            this._multicopy.queue.push({ _id: nextId, text, app, time: Date.now(), masked, truncated });
            this._capturedSinceHint = true;
            this._onChanged(null);
            return;
        }

        const entry = this._store.add({
            text,
            app,
            time: Date.now(),
            masked,
            truncated,
            kind,
        });
        this._capturedSinceHint = true;
        this._onChanged(entry);
    }

    _sourceAppName() {
        try {
            const win = global.display.focus_window;
            if (!win) return '';
            const tracker = Shell.WindowTracker.get_default();
            const app = tracker.get_window_app(win);
            if (app) return app.get_name() || win.get_wm_class() || '';
            return win.get_wm_class() || '';
        } catch {
            return '';
        }
    }

    _sourceAppId() {
        try {
            const win = global.display.focus_window;
            if (!win) return '';
            const tracker = Shell.WindowTracker.get_default();
            const app = tracker.get_window_app(win);
            return app ? (app.get_id() || '') : '';
        } catch {
            return '';
        }
    }

    // Substring match on app name OR desktop app-id (§2.6: ids are stable
    // even when the display name is localized).
    _isExcluded(appName, appId = '') {
        const id = appId || this._sourceAppId();
        return this._settings.get_strv('excluded-apps')
            .some((e) => {
                if (!e) return false;
                const needle = e.toLowerCase();
                return appName.toLowerCase().includes(needle) ||
                    id.toLowerCase().includes(needle);
            });
    }

    // Called by the injector before it writes the clipboard on our behalf.
    markInternalSet() {
        this._suppressOwnSet = true;
    }

    // S33 residual hole: extension enabled while a secret is on the clipboard.
    // Arm the re-offer window immediately without reading anything.
    armReofferIfHinted() {
        const mimes = global.display.get_selection()
            .get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
        if (mimes && mimes.includes(HINT_MIME)) {
            this._lastHintedAt = GLib.get_monotonic_time() / GLib.USEC_PER_SEC;
            this._capturedSinceHint = false;
        }
    }

    _logOnce(kind, message) {
        if (this._logged.has(kind)) return;
        this._logged.add(kind);
        console.log(`[cliplet] ${message}`);
    }
}
