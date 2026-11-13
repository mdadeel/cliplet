// Memory-only history store (DR-06 / D3: no persistence in V1).
// Pins are a separate list: they survive "clear history" and are excluded
// from the recents view while pinned (§09: 2 pinned + 6 recent).

import GLib from 'gi://GLib';

export class MemoryStore {
    constructor(capacity = 200, onDirty = null) {
        this._capacity = capacity;
        this._recent = [];   // newest first
        this._pins = [];     // pinned order, oldest pin first
        this._byHash = new Map();  // hash -> entry (dedupe, F21)
        this._nextId = 1;
        this._lastDeleted = null;
        this._lastTransform = null;
        this._dirty = onDirty;   // optional: fired on every mutation (persistence)
    }

    get recent() { return this._recent; }
    get pins() { return this._pins; }
    get count() { return this._recent.length + this._pins.length; }

    setCapacity(n) {
        this._capacity = n;
        this._dirty?.();
        this._pruneRecent();
    }

    add({ text = '', app, time, masked = false, truncated = false, kind = null, bytes = null, mime = null }) {
        this._dirty?.();
        // Image clips hash over their bytes so two different images never
        // collide on an empty text field.
        const hash = (kind === 'image' && bytes)
            ? (GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes) || String(bytes.length))
            : (GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1) || String(text.length));

        // Duplicate: already pinned -> keep the pin, refresh nothing.
        const existing = this._byHash.get(hash);
        if (existing && existing.pinned) {
            existing.time = time;
            existing.app = app || existing.app;
            return existing;
        }
        if (existing) {
            // Move to top, keep identity stable for any open UI.
            this._recent.splice(this._recent.indexOf(existing), 1);
            existing.time = time;
            existing.app = app || existing.app;
            existing.masked = masked;
            this._recent.unshift(existing);
            return existing;
        }

        const entry = {
            id: this._nextId++,
            text,
            hash,
            app: app || '',
            time,
            masked,
            truncated,
            kind,
            bytes,
            mime,
            pinned: false,
        };
        this._recent.unshift(entry);
        this._byHash.set(hash, entry);
        this._pruneRecent();
        return entry;
    }

    _pruneRecent() {
        while (this._recent.length > this._capacity) {
            const dropped = this._recent.pop();
            this._byHash.delete(dropped.hash);
        }
    }

    pin(entry) {
        if (entry.pinned) return;
        this._dirty?.();
        entry.pinned = true;
        if (this._recent.includes(entry)) {
            this._recent.splice(this._recent.indexOf(entry), 1);
        }
        this._pins.push(entry);
    }

    unpin(entry) {
        if (!entry.pinned) return;
        this._dirty?.();
        entry.pinned = false;
        this._pins.splice(this._pins.indexOf(entry), 1);
        this._recent.unshift(entry);
        this._pruneRecent();
    }

    togglePin(entry) {
        if (entry.pinned) this.unpin(entry);
        else this.pin(entry);
        return entry.pinned;
    }

    delete(entry) {
        this._dirty?.();
        // Single-level undo buffer (F7).
        this._lastDeleted = { entry, pinned: entry.pinned, index: this._recent.indexOf(entry) };
        this._remove(entry);
    }

    _remove(entry) {
        if (entry.pinned) {
            this._pins.splice(this._pins.indexOf(entry), 1);
        } else {
            const i = this._recent.indexOf(entry);
            if (i >= 0) this._recent.splice(i, 1);
        }
        this._byHash.delete(entry.hash);
    }

    undoDelete() {
        if (!this._lastDeleted) return null;
        this._dirty?.();
        const { entry, pinned } = this._lastDeleted;
        this._lastDeleted = null;
        if (pinned) {
            entry.pinned = false; // pin() re-adds
            this.pin(entry);
        } else {
            this._byHash.set(entry.hash, entry);
            this._recent.unshift(entry);
            this._pruneRecent();
        }
        return entry;
    }

    // Text transform: replace in place, single-level undo (shares the one
    // undo slot with delete/clear — one operation is undoable at a time).
    updateText(entry, text) {
        this._dirty?.();
        this._lastTransform = { entry, text: entry.text };
        this._lastDeleted = null;
        this._retext(entry, text);
        return entry;
    }

    undo() {
        this._dirty?.();
        if (this._lastTransform) {
            const { entry, text } = this._lastTransform;
            this._lastTransform = null;
            this._retext(entry, text);
            return entry;
        }
        if (this._lastDeleted) {
            return this._lastDeleted.entries
                ? (this.undoClear() ? this._recent[0] : null)
                : this.undoDelete();
        }
        return null;
    }

    _retext(entry, text) {
        this._byHash.delete(entry.hash);
        entry.text = text;
        entry.hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1)
            || String(text.length);
        const other = this._byHash.get(entry.hash);
        if (other && other !== entry) this._remove(other);   // dedupe the result
        this._byHash.set(entry.hash, entry);
    }

    hasUndo() { return this._lastDeleted !== null || this._lastTransform !== null; }

    clearHistory() {
        this._dirty?.();
        // Pins survive clear (§09 #6). Undo restores the pre-clear recents.
        this._lastDeleted = { entries: [...this._recent] };
        for (const e of this._recent) this._byHash.delete(e.hash);
        this._recent = [];
    }

    undoClear() {
        if (!this._lastDeleted || !this._lastDeleted.entries) return false;
        this._dirty?.();
        for (const e of this._lastDeleted.entries) {
            this._byHash.set(e.hash, e);
            this._recent.push(e);
        }
        this._lastDeleted = null;
        return true;
    }

    search(query) {
        const q = query.trim().toLowerCase();
        if (!q) return { pins: [...this._pins], recent: [...this._recent] };
        const tokens = q.split(/\s+/);
        const match = (e) => {
            const hay = (e.text + '\n' + e.app).toLowerCase();
            return tokens.every((t) => hay.includes(t));
        };
        return {
            pins: this._pins.filter(match),
            recent: this._recent.filter(match),
        };
    }

    // Bulk restore from a saved session (persist.load): entries oldest
    // first, `pinned` flags honoured. Runs with the dirty hook suspended —
    // restoring must not immediately schedule a save-back.
    restoreFrom(entries) {
        const dirty = this._dirty;
        this._dirty = null;
        try {
            for (const e of entries) {
                const added = this.add({
                    text: e.text,
                    app: e.app || '',
                    time: e.time || Date.now(),
                    masked: false,          // secrets are never persisted
                    truncated: !!e.truncated,
                });
                if (added && e.pinned) this.pin(added);
            }
        } finally {
            this._dirty = dirty;
        }
    }

    dispose() {
        this._recent = [];
        this._pins = [];
        this._byHash.clear();
        this._lastDeleted = null;
        this._lastTransform = null;
    }
}
