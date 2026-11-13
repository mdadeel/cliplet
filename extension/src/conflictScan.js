// Conflict report (V0b): name the owner of an accelerator as far as is
// honestly knowable, never guess. Two sources can be *named*:
//   1. stock org.gnome.shell.keybindings chords,
//   2. the user's own custom shortcuts (gnome-settings-daemon media-keys,
//      relocatable paths — invisible to a plain schema sweep, which is
//      exactly where a Windows-style Super+V usually hides).
// Anything else stays "another component". Shell-free: importable from
// prefs.js (separate GTK process) and the shell process alike.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MEDIA_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';
const CUSTOM_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';

// Every custom shortcut the user has defined: {path, name, command, binding}.
export function listCustomBindings() {
    const out = [];
    try {
        const base = Gio.Settings.new(MEDIA_KEYS);
        for (const path of base.get_strv('custom-keybindings')) {
            try {
                const s = Gio.Settings.new_with_path(CUSTOM_SCHEMA, path);
                out.push({
                    path,
                    name: s.get_string('name'),
                    command: s.get_string('command'),
                    binding: s.get_string('binding'),
                });
            } catch {
                // unreadable entry — skip it rather than report it wrongly
            }
        }
    } catch {
        // media-keys schema absent — no custom shortcuts exist
    }
    return out;
}

// Custom shortcuts currently holding `accel`.
export function listCustomHolders(accel) {
    if (!accel) return [];
    return listCustomBindings().filter(c => c.binding && c.binding.trim() === accel);
}

// Human phrase for whoever owns `accel`, or null when nothing nameable does.
export function findConflict(accel) {
    if (!accel) return null;
    try {
        const schema = Gio.Settings.new('org.gnome.shell.keybindings');
        for (const key of schema.list_keys()) {
            const value = schema.get_value(key);
            if (!value.is_of_type(Gio.VariantType.new('as'))) continue;
            if (value.deep_unpack().includes(accel)) {
                return `GNOME Shell's "${key}" already uses ${accel}`;
            }
        }
    } catch {
        // Schema unreadable — fall through to the custom scan.
    }
    const holders = listCustomHolders(accel);
    if (holders.length === 1) {
        const name = holders[0].name || holders[0].path;
        return `your custom shortcut "${name}" owns it`;
    }
    if (holders.length > 1)
        return `${holders.length} of your custom shortcuts own it`;
    return null;
}

// Hand an accelerator over: release the custom shortcut (its name and
// command stay untouched in dconf — only the binding is cleared) and return
// the previous binding so the caller can record it for restoration.
export function releaseCustom(path) {
    const s = Gio.Settings.new_with_path(CUSTOM_SCHEMA, path);
    const previous = s.get_string('binding');
    s.set_string('binding', '');
    Gio.Settings.sync();
    return previous;
}

// Put a released shortcut back exactly as it was.
export function restoreCustom(path, binding) {
    const s = Gio.Settings.new_with_path(CUSTOM_SCHEMA, path);
    s.set_string('binding', binding);
    Gio.Settings.sync();
}

// --- released-bindings bookkeeping (a(ss) of (path, previous binding)) -----

export function releasedList(settings) {
    return settings.get_value('released-bindings').deep_unpack();
}

export function recordReleased(settings, path, previousBinding) {
    const list = releasedList(settings).filter(([p]) => p !== path);
    list.push([path, previousBinding]);
    settings.set_value('released-bindings', new GLib.Variant('a(ss)', list));
}

export function dropReleased(settings, path) {
    const list = releasedList(settings).filter(([p]) => p !== path);
    settings.set_value('released-bindings', new GLib.Variant('a(ss)', list));
}
