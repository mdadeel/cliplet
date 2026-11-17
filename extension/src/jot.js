// Jot Pad (docs/15 §3.2): a small always-on-top floating scratch pad.
// Non-modal (no grab — the user works in other windows while it stays
// visible), draggable by its header, autosaves to
// ~/.config/cliplet/jot.txt (user-authored content, like snippets).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Drag header as a registered subclass: event *signals* on plain St.Widgets
// throw per event on Shell 50 (the source of the "slow" complaint).
const JotHeader = GObject.registerClass({
    GTypeName: 'ClipletJotHeader',
}, class JotHeader extends St.BoxLayout {
    vfunc_button_press_event(event) {
        return this._onPress ? this._onPress(event) : Clutter.EVENT_PROPAGATE;
    }
    vfunc_motion_event(event) {
        return this._onMotion ? this._onMotion(event) : Clutter.EVENT_PROPAGATE;
    }
    vfunc_button_release_event(event) {
        return this._onRelease ? this._onRelease(event) : Clutter.EVENT_PROPAGATE;
    }
});

export class JotPad {
    constructor() {
        const dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'cliplet']);
        this._path = GLib.build_filenamev([dir, 'jot.txt']);
        this._actor = null;
        this._saveId = 0;
        this._text = this._load();
    }

    get path() {
        return this._path;
    }

    _load() {
        try {
            const [, bytes] = GLib.file_get_contents(this._path);
            return new TextDecoder().decode(bytes);
        } catch {
            return '';   // no jot yet
        }
    }

    get isOpen() {
        return this._actor !== null && this._actor.is_visible();
    }

    toggle() {
        if (this.isOpen) {
            this._actor.hide();
            return false;
        }
        this._show();
        return true;
    }

    _show() {
        if (!this._actor) this._build();
        this._applyTheme();
        this._actor.show();
    }

    _applyTheme() {
        if (!this._actor) return;
        const scheme = this._iface?.get_string('color-scheme');
        const dark = scheme === 'prefer-dark';
        this._actor.style_class = `cliplet-shell ${dark ? 'cliplet-dark' : 'cliplet-light'}`;
        if (this._clutterText) {
            this._clutterText.color = dark
                ? new Clutter.Color({ red: 255, green: 255, blue: 255, alpha: 255 })
                : new Clutter.Color({ red: 26, green: 26, blue: 26, alpha: 255 });
        }
    }

    _build() {
        this._iface = Gio.Settings.new('org.gnome.desktop.interface');
        this._themeChangedId = this._iface.connect('changed::color-scheme', () => this._applyTheme());

        const monitor = Main.layoutManager.primaryMonitor;
        this._actor = new St.BoxLayout({
            vertical: true,
            style_class: 'cliplet-shell',
            x: monitor.x + monitor.width - 372,
            y: monitor.y + 60,
        });
        this._actor.width = 360;
        this._actor.height = 300;

        // header: drag handle + title + close
        const header = new JotHeader({ style_class: 'cliplet-header', height: 40 });
        this._actor.add_child(header);
        header.add_child(new St.Label({
            text: 'Jot Pad',
            style_class: 'cliplet-section',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const spacer = new St.Widget({ x_expand: true });
        header.add_child(spacer);
        const close = new St.Button({
            style_class: 'cliplet-overflow',
            child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 16 }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        close.connect('clicked', () => this._actor.hide());
        header.add_child(close);

        // the pad itself: Clutter.Text is the only multi-line editable text
        // actor in the shell — St.Entry is single-line only.
        const frame = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true, y_expand: true,
            style_class: 'cliplet-viewport',
        });
        this._actor.add_child(frame);
        this._clutterText = new Clutter.Text({
            text: this._text,
            editable: true,
            single_line_mode: false,
            line_wrap: true,
            line_wrap_mode: 2,      // Pango.WrapMode.WORD_CHAR
            activatable: false,
            x_expand: true,
            y_expand: true,
        });
        frame.add_child(this._clutterText);
        this._applyTheme();

        Main.layoutManager.uiGroup.add_child(this._actor);

        // dragging by the header (non-modal: vfunc events on the subclass)
        let drag = null;
        header._onPress = (event) => {
            const [wx, wy] = this._actor.get_transformed_position();
            const [ex, ey] = event.get_coords();
            drag = { sx: ex, sy: ey, ox: wx, oy: wy };
            return Clutter.EVENT_STOP;
        };
        header._onMotion = (event) => {
            if (!drag) return Clutter.EVENT_PROPAGATE;
            const [ex, ey] = event.get_coords();
            this._actor.set_position(
                Math.max(0, drag.ox + (ex - drag.sx)),
                Math.max(0, drag.oy + (ey - drag.sy)));
            return Clutter.EVENT_STOP;
        };
        header._onRelease = () => {
            drag = null;
            return Clutter.EVENT_STOP;
        };

        // autosave (debounced)
        this._textChangedId = this._clutterText.connect('text-changed', () => {
            if (this._saveId) GLib.source_remove(this._saveId);
            this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                this._saveId = 0;
                this._flushSave();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _flushSave() {
        if (!this._clutterText) return;
        this._text = this._clutterText.text;
        try {
            const dir = Gio.File.new_for_path(GLib.path_get_dirname(this._path));
            try { dir.make_directory_with_parents(null); } catch { /* exists */ }
            const file = Gio.File.new_for_path(this._path);
            const bytes = new GLib.Bytes(new TextEncoder().encode(this._text));
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (f, res) => {
                try { f.replace_contents_finish(res); } catch { /* ignore */ }
            });
        } catch (e) {
            console.warn(`[cliplet] jot save failed: ${e.message}`);
        }
    }

    destroy() {
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
            this._flushSave();
        }
        if (this._themeChangedId) {
            this._iface?.disconnect(this._themeChangedId);
            this._themeChangedId = 0;
        }
        this._actor?.destroy();
        this._actor = null;
    }
}
