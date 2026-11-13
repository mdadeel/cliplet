// Optional history persistence — STRICTLY opt-in, privacy-filtered.
// The decision register (D3) keeps clipboard residue off disk by default;
// this is the explicit opt-out of that default: a user setting turns it on,
// masked (possible-secret) entries and image bytes are never written, and
// turning the setting off deletes the file. Text only, capped by
// history-size. File: ~/.config/cliplet/history.json.
//
// No shell imports; safe in the prefs process if ever needed there.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const SAVE_DEBOUNCE_MS = 1500;

export class HistoryPersist {
    constructor({ settings, store }) {
        this._settings = settings;
        this._store = store;
        const dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'cliplet']);
        this._path = GLib.build_filenamev([dir, 'history.json']);
        this._debounceId = 0;
    }

    get path() {
        return this._path;
    }

    // Restore the saved session into the (empty) store. Called on enable()
    // before capture starts; hash dedupe makes a re-load idempotent.
    load() {
        let parsed = null;
        try {
            const [, bytes] = GLib.file_get_contents(this._path);
            parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            return 0;   // missing or corrupt file — start empty
        }
        if (!parsed || !Array.isArray(parsed.entries)) return 0;
        const cap = this._settings.get_int('history-size');
        const list = parsed.entries
            .filter((e) => e && typeof e.text === 'string' && !e.masked)
            .slice(-cap);   // keep the newest `cap` (file is oldest-first)
        this._store.restoreFrom(list);
        return list.length;
    }

    schedule() {
        if (!this._settings.get_boolean('persist-history')) return;
        if (this._debounceId) GLib.source_remove(this._debounceId);
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this.save();
            return GLib.SOURCE_REMOVE;
        });
    }

    save() {
        // oldest-first tail: pins last so `slice(-cap)` never drops a pin
        const ser = (e, pinned) => (e.masked || e.kind === 'image') ? null
            : {
                text: e.text,
                app: e.app || '',
                time: e.time || 0,
                truncated: !!e.truncated,
                pinned,
            };
        const entries = [
            ...this._store.recent.map((e) => ser(e, false)).reverse(),
            ...this._store.pins.map((e) => ser(e, true)),
        ].filter(Boolean).slice(-this._settings.get_int('history-size'));
        try {
            const dir = Gio.File.new_for_path(GLib.path_get_dirname(this._path));
            try { dir.make_directory_with_parents(null); } catch { /* exists */ }
            GLib.file_set_contents(this._path, JSON.stringify({ version: 1, entries }));
        } catch (e) {
            console.warn(`[cliplet] history save failed: ${e.message}`);
        }
    }

    // Setting turned off: the file IS the residue — delete it.
    clear() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        try {
            Gio.File.new_for_path(this._path).delete(null);
        } catch {
            // absent — nothing to clear
        }
    }

    destroy() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
    }
}
