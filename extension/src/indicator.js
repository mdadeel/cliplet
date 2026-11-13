// Panel indicator: Cliplet lives in the top bar so the popup is reachable
// without any accelerator at all (the chord may be owned by something else —
// the indicator never is).
//
// Menu: open popup (both modes), pause capture, preferences. Visibility
// follows the modules: no modules, no indicator (same zero-footprint rule
// as §03.5/V10).

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const ClipletIndicator = GObject.registerClass(
class ClipletIndicator extends PanelMenu.Button {
    _init({ settings, onOpen, onPrefs, onJot }) {
        super._init(0.0, 'Cliplet', false);
        this._settings = settings;
        this._onOpen = onOpen;
        this._onPrefs = onPrefs;
        this._onJot = onJot;

        this._icon = new St.Icon({
            icon_name: 'cliplet-symbolic',
            fallback_icon_name: 'edit-paste-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        const clipboardItem = new PopupMenu.PopupMenuItem('Open Cliplet');
        clipboardItem.connect('activate', () => this._defer(() => this._onOpen('clipboard')));
        this.menu.addMenuItem(clipboardItem);

        const emojiItem = new PopupMenu.PopupMenuItem('Emoji picker');
        emojiItem.connect('activate', () => this._defer(() => this._onOpen('emoji')));
        this.menu.addMenuItem(emojiItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Two-way: the switch writes the key, the watcher re-reads it (the
        // popup menu has its own pause toggle; both stay in sync via dconf).
        this._pauseItem = new PopupMenu.PopupSwitchMenuItem(
            'Pause capture', settings.get_boolean('pause-capture'));
        this._pauseItem.connect('toggled', (item) => {
            settings.set_boolean('pause-capture', item.state);
        });
        this.menu.addMenuItem(this._pauseItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const jotItem = new PopupMenu.PopupMenuItem('Jot Pad');
        jotItem.connect('activate', () => this._defer(() => this._onJot()));
        this.menu.addMenuItem(jotItem);

        const prefsItem = new PopupMenu.PopupMenuItem('Preferences');
        prefsItem.connect('activate', () => this._defer(() => this._onPrefs()));
        this.menu.addMenuItem(prefsItem);

        this._watchers = [
            settings.connect('changed::pause-capture', () => {
                this._pauseItem.setToggleState(settings.get_boolean('pause-capture'));
                this._updateIcon();
            }),
            settings.connect('changed::enable-clipboard', () => this._updateVisibility()),
            settings.connect('changed::enable-emoji', () => this._updateVisibility()),
        ];
        this._updateVisibility();
        this._updateIcon();
    }

    // Menu activation closes the menu and releases its grab; opening the
    // modal popup in the same cycle can grab-battle, so defer one idle tick.
    _defer(cb) {
        GLib.idle_add_once(GLib.PRIORITY_DEFAULT, cb);
    }

    _updateVisibility() {
        this.visible = this._settings.get_boolean('enable-clipboard') ||
            this._settings.get_boolean('enable-emoji');
    }

    _updateIcon() {
        this._icon.icon_name = this._settings.get_boolean('pause-capture')
            ? 'media-playback-pause-symbolic'
            : 'edit-paste-symbolic';
    }

    destroy() {
        for (const id of this._watchers || [])
            this._settings.disconnect(id);
        this._watchers = [];
        super.destroy();
    }
});

export default ClipletIndicator;
