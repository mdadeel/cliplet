// Keybinding manager (DR-11/12): accelerators are taken via
// grab_accelerator + allowKeybinding — Cliplet never writes
// org.gnome.shell.keybindings, so releasing restores the previous owner
// instantly (V0b's second question).
//
// Conflict report: findConflict() names what can be named honestly (stock
// chords, the user's own custom shortcuts) and stays silent otherwise — a
// failed grab with no nameable owner is reported as "another component".
// An owner that is named wrongly is worse than one named imprecisely (V0b).

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { findConflict } from './conflictScan.js';

export class KeybindingManager {
    constructor() {
        this._grabs = new Map();   // id -> {accel, action, name}
        this._activatedId = 0;
    }

    enable(onActivate) {
        this._onActivate = onActivate;
        this._activatedId = global.display.connect('accelerator-activated',
            (display, action) => this._onAccelerator(action));
    }

    disable() {
        for (const grab of this._grabs.values()) {
            global.display.ungrab_accelerator(grab.action);
        }
        this._grabs.clear();
        if (this._activatedId) {
            global.display.disconnect(this._activatedId);
            this._activatedId = 0;
        }
        this._onActivate = null;
    }

    grab(id, accelerator, onActivate) {
        if (this._grabs.has(id)) this.ungrab(id);
        if (!accelerator) return { ok: true, conflict: null };

        const action = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.NONE);
        if (action === Meta.KeyBindingAction.NONE) {
            return { ok: false, conflict: findConflict(accelerator) };
        }
        const name = Meta.external_binding_name_for_action(action);
        Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);
        this._grabs.set(id, { accel: accelerator, action, name, onActivate });
        return { ok: true, conflict: findConflict(accelerator) };
    }

    ungrab(id) {
        const grab = this._grabs.get(id);
        if (!grab) return;
        global.display.ungrab_accelerator(grab.action);
        this._grabs.delete(id);
    }

    _onAccelerator(action) {
        for (const grab of this._grabs.values()) {
            if (grab.action === action && grab.onActivate) {
                grab.onActivate();
                return;
            }
        }
    }
}
