// Snippets (docs/15 §2.1): user-authored, frequently used text. The ONE
// thing Cliplet persists — and deliberately so: snippets are written by the
// user on purpose, which puts them outside the D3 rule (clipboard residue
// never touches disk). The file lives in $XDG_CONFIG_HOME/cliplet/.
//
// No shell imports; used by both the shell process and the prefs process.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export class Snippets {
    constructor() {
        const dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'cliplet']);
        this._path = GLib.build_filenamev([dir, 'snippets.json']);
        this._entries = [];
        this._load();
    }

    get path() {
        return this._path;
    }

    _load() {
        try {
            const [, bytes] = GLib.file_get_contents(this._path);
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            if (Array.isArray(parsed)) {
                this._entries = parsed
                    .filter((s) => s && typeof s.name === 'string' && typeof s.text === 'string')
                    .map((s) => ({ name: s.name, text: s.text }));
            }
        } catch {
            this._entries = [];   // missing or corrupt file — start empty
        }
    }

    _save() {
        try {
            const dir = Gio.File.new_for_path(GLib.path_get_dirname(this._path));
            try { dir.make_directory_with_parents(null); } catch { /* exists */ }
            const json = JSON.stringify(this._entries, null, 2);
            GLib.file_set_contents(this._path, json);
        } catch (e) {
            console.warn(`[cliplet] snippet save failed: ${e.message}`);
        }
    }

    list() {
        this._load();   // cross-process: prefs may have edited the file
        return this._entries.map((s) => ({ ...s }));
    }

    // Insert-or-update by name (names are the identity for the prefs editor).
    set(name, text) {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const existing = this._entries.find((s) => s.name === trimmed);
        if (existing) {
            existing.text = text;
        } else {
            this._entries.push({ name: trimmed, text });
        }
        this._save();
        return trimmed;
    }

    remove(name) {
        const before = this._entries.length;
        this._entries = this._entries.filter((s) => s.name !== name);
        if (this._entries.length !== before) this._save();
    }

    // Tokens matched against name + text, same style as the history search.
    search(query) {
        this._load();   // cross-process: prefs may have edited the file
        const q = query.trim().toLowerCase();
        if (!q) return this.list();
        const tokens = q.split(/\s+/);
        return this.list().filter((s) => {
            const hay = (s.name + '\n' + s.text).toLowerCase();
            return tokens.every((t) => hay.includes(t));
        });
    }
}
