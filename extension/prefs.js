// Cliplet preferences — GTK4 + libadwaita, a separate process (S9 policy:
// no Gtk in the shell process, no Clutter/Meta/St here).
//
// Shortcut assignment (DR-11): per module, user-assigned, presets carry a
// conflict report BEFORE the chord is taken. The report names what can be
// named honestly: stock org.gnome.shell.keybindings chords and the user's
// own custom shortcuts (media-keys); anything else is reported as such,
// never guessed (V0b). Taking over a custom shortcut is explicit and
// reversible — the previous binding is kept here for restoration.

import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    findConflict, listCustomHolders, releaseCustom, recordReleased,
    releasedList, dropReleased, restoreCustom,
} from './src/conflictScan.js';
import { Snippets } from './src/snippets.js';

const PRESETS = [
    { label: 'Windows-style · Super+V', accel: '<Super>v', module: 'clipboard' },
    { label: 'Windows-style · Super+. (period)', accel: '<Super>period', module: 'emoji' },
];

// Shell 50 contract: the host owns the Adw.PreferencesWindow and calls
// fillPreferencesWindow(window) on a fresh instance per prefs request.
// getSettings() (ExtensionBase) reads metadata['settings-schema'] through a
// schema source built from the extension's schemas/ dir — constructing
// Gio.Settings directly against the default source fails with "schema not
// found" because that source never sees the extension's schemas folder.
export default class ClipletPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        this._window = window;
        window.set_default_size(640, 640);
        // Brand the window (window lists / overview pick this up where the
        // platform honours it); the shipped hicolor icon supplies the art.
        window.set_icon_name('cliplet');

        this._settings = this.getSettings();

        window.add(this._modulesPage());
        window.add(this._clipboardPage());
        window.add(this._emojiPage());
        window.add(this._snippetsPage());
        window.add(this._shortcutsPage());
        window.add(this._privacyPage());
    }

    // Snippets editor (docs/15 §2.1): user-authored text, the only thing
    // Cliplet writes to disk (~/.config/cliplet/snippets.json). History
    // stays memory-only — snippets are authored on purpose, not residue.
    _snippetsPage() {
        this._snippetStore = new Snippets();
        this._snipSaveId = 0;

        const page = new Adw.PreferencesPage({ title: 'Snippets', icon_name: 'edit-cut-symbolic' });
        const group = new Adw.PreferencesGroup({
            title: 'Snippets',
            description: 'Frequently used text, inserted at the cursor from the popup. Stored in ~/.config/cliplet/snippets.json — snippets are authored on purpose, so unlike history they are always persisted.',
        });
        this._snipName = new Adw.EntryRow({
            title: 'New snippet name — press Enter',
            show_apply_button: true,
        });
        this._snipName.connect('apply', () => {
            const name = this._snipName.text.trim();
            if (!name) return;
            this._snippetStore.set(name, '');
            this._snipName.text = '';
            this._rebuildSnippets();
        });
        group.add(this._snipName);
        page.add(group);

        this._snipGroup = new Adw.PreferencesGroup({ title: 'Saved snippets' });
        page.add(this._snipGroup);
        this._snipRows = [];
        this._rebuildSnippets();
        return page;
    }

    _rebuildSnippets() {
        for (const row of this._snipRows || [])
            this._snipGroup.remove(row);
        this._snipRows = [];

        for (const snippet of this._snippetStore.list()) {
            const row = new Adw.ExpanderRow({
                title: snippet.name,
                subtitle: snippet.text.split('\n')[0].slice(0, 60) || '(empty)',
            });

            const frame = new Gtk.Frame();
            const view = new Gtk.TextView({
                wrap_mode: Gtk.WrapMode.WORD_CHAR,
                margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6,
                pixels_above_lines: 2, pixels_below_lines: 2,
            });
            view.set_size_request(-1, 120);
            view.buffer.text = snippet.text;
            frame.child = view;
            const holder = new Adw.ActionRow({});
            holder.child = frame;
            row.add_row(holder);

            const del = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            del.connect('clicked', () => {
                this._snippetStore.remove(snippet.name);
                this._rebuildSnippets();
            });
            row.add_suffix(del);

            let saveId = 0;
            view.buffer.connect('changed', () => {
                if (saveId) GLib.source_remove(saveId);
                const text = view.buffer.text;
                saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    this._snippetStore.set(snippet.name, text);
                    row.subtitle = text.split('\n')[0].slice(0, 60) || '(empty)';
                    return GLib.SOURCE_REMOVE;
                });
            });

            this._snipGroup.add(row);
            this._snipRows.push(row);
        }
        if (!this._snipRows.length) {
            const empty = new Adw.ActionRow({ title: 'No snippets yet' });
            this._snipGroup.add(empty);
            this._snipRows.push(empty);
        }
    }

    _modulesPage() {
        const page = new Adw.PreferencesPage({ title: 'Modules', icon_name: 'view-grid-symbolic' });
        const group = new Adw.PreferencesGroup({
            title: 'Modules',
            description: 'Each module works independently. A disabled module leaves no runtime footprint: no clipboard connection, no data.',
        });

        const clip = new Adw.SwitchRow({ title: 'Clipboard history' });
        const emoji = new Adw.SwitchRow({ title: 'Emoji picker' });
        this._settings.bind('enable-clipboard', clip, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('enable-emoji', emoji, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(clip);
        group.add(emoji);
        page.add(group);

        // OCR (docs/15 §3.1): S9 exception — opt-in, requires tesseract on
        // PATH, everything local.
        const ocr = new Adw.PreferencesGroup({
            title: 'OCR — screen to text (opt-in)',
            description: 'Select a screen region and its text lands on the clipboard and in history. Requires tesseract-ocr installed (checked at runtime); everything runs locally.',
        });
        const ocrSwitch = new Adw.SwitchRow({ title: 'Enable OCR' });
        this._settings.bind('enable-ocr', ocrSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        const ocrLang = new Adw.EntryRow({ title: 'tesseract language (e.g. eng, deu)' });
        this._settings.bind('ocr-language', ocrLang, 'text', Gio.SettingsBindFlags.DEFAULT);
        ocr.add(ocrSwitch);
        ocr.add(ocrLang);
        page.add(ocr);
        return page;
    }

    _clipboardPage() {
        const page = new Adw.PreferencesPage({ title: 'Clipboard', icon_name: 'edit-paste-symbolic' });
        const group = new Adw.PreferencesGroup({
            title: 'History',
            description: 'History is kept in memory and clears on logout or screen lock — unless persistence below is switched on. Possible secrets are never stored either way.',
        });

        const size = Adw.SpinRow.new_with_range(50, 2000, 50);
        size.title = 'Maximum entries';
        this._settings.bind('history-size', size, 'value', Gio.SettingsBindFlags.DEFAULT);

        const cap = Adw.SpinRow.new_with_range(1, 1024, 16);
        cap.title = 'Per-item text cap (KiB)';
        this._settings.bind('text-cap-kb', cap, 'value', Gio.SettingsBindFlags.DEFAULT);

        const pause = new Adw.SwitchRow({
            title: 'Pause capture (private mode)',
            subtitle: 'Nothing is recorded while paused. Toggle also available in the popup menu.',
        });
        this._settings.bind('pause-capture', pause, 'active', Gio.SettingsBindFlags.DEFAULT);

        group.add(size);
        group.add(cap);
        group.add(pause);
        const images = new Adw.SwitchRow({
            title: 'Capture images',
            subtitle: 'Memory-only, up to 8 MB per clip. Thumbnails and image paste.',
        });
        this._settings.bind('enable-image-capture', images, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(images);
        const compact = new Adw.SwitchRow({
            title: 'Compact quick-picker',
            subtitle: 'Smaller list-only popup without the keycap footer.',
        });
        this._settings.bind('compact-picker', compact, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(compact);
        const persist = new Adw.SwitchRow({
            title: 'Remember history between sessions',
            subtitle: 'Opt-in and local only: saves text history to ~/.config/cliplet/history.json. Secrets and images are never saved; switching this off deletes the file.',
        });
        this._settings.bind('persist-history', persist, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(persist);
        page.add(group);
        page.add(this._exclusionsGroup());
        return page;
    }

    // App exclusions (docs/15 §1.3): never record clips from these apps.
    // Case-insensitive substring match on the copy source's app name.
    _exclusionsGroup() {
        this._exclGroup = new Adw.PreferencesGroup({
            title: 'App exclusions',
            description: 'Clips copied from these apps are never recorded. Matched by part of the app name — e.g. “Bitwarden”, “1Password”.',
        });
        this._exclEntry = new Adw.EntryRow({
            title: 'Add an app name and press Enter',
            show_apply_button: true,
        });
        this._exclEntry.connect('apply', () => {
            const value = this._exclEntry.text.trim();
            if (!value) return;
            const list = this._settings.get_strv('excluded-apps');
            if (!list.some((x) => x.toLowerCase() === value.toLowerCase())) {
                list.push(value);
                this._settings.set_strv('excluded-apps', list);
            }
            this._exclEntry.text = '';
            this._rebuildExclusions();
        });
        this._exclGroup.add(this._exclEntry);
        this._exclRows = [];
        this._rebuildExclusions();
        return this._exclGroup;
    }

    _rebuildExclusions() {
        for (const row of this._exclRows || [])
            this._exclGroup.remove(row);
        this._exclRows = [];
        for (const app of this._settings.get_strv('excluded-apps')) {
            const row = new Adw.ActionRow({ title: app });
            const btn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            btn.connect('clicked', () => {
                this._settings.set_strv('excluded-apps',
                    this._settings.get_strv('excluded-apps').filter((x) => x !== app));
                this._rebuildExclusions();
            });
            row.add_suffix(btn);
            this._exclGroup.add(row);
            this._exclRows.push(row);
        }
    }

    _emojiPage() {
        const page = new Adw.PreferencesPage({ title: 'Emoji', icon_name: 'face-smile-symbolic' });
        const group = new Adw.PreferencesGroup({
            title: 'Behaviour',
            description: 'Insertion is guarded: if the focused window changed while the popup was open, the glyph is copied instead of typed.',
        });

        const autoInsert = new Adw.SwitchRow({
            title: 'Insert at cursor on click',
            subtitle: 'Off = clicking copies the glyph to the clipboard.',
        });
        this._settings.bind('emoji-auto-insert', autoInsert, 'active', Gio.SettingsBindFlags.DEFAULT);

        const tone = new Adw.ComboRow({ title: 'Preferred skin tone' });
        const model = new Gtk.StringList();
        for (const name of ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark']) {
            model.append(name);
        }
        tone.model = model;
        // selected maps 0..5; setting is 0..4 with 0 = default (no modifier)
        tone.set_selected(this._settings.get_int('emoji-tone'));
        tone.connect('notify::selected', () => {
            this._settings.set_int('emoji-tone', tone.selected);
        });

        group.add(autoInsert);
        group.add(tone);
        page.add(group);
        return page;
    }

    _shortcutsPage() {
        const page = new Adw.PreferencesPage({ title: 'Shortcuts', icon_name: 'input-keyboard-symbolic' });
        const group = new Adw.PreferencesGroup({
            title: 'Accelerators',
            description: 'Nothing is bound until you assign it. Cliplet never edits GNOME’s own keybindings; releasing ours restores the previous behaviour instantly.',
        });

        group.add(this._shortcutRow('Clipboard popup', 'shortcut-clipboard', 'clipboard'));
        group.add(this._shortcutRow('Emoji picker', 'shortcut-emoji', 'emoji'));
        page.add(group);

        const presets = new Adw.PreferencesGroup({
            title: 'Presets',
            description: 'One-click setups. The conflict report is shown before the key is taken.',
        });
        for (const preset of PRESETS) {
            const row = new Adw.ActionRow({ title: preset.label });
            const holders = listCustomHolders(preset.accel);
            if (holders.length) {
                const named = holders.map(h => h.name || h.path).join(', ');
                row.subtitle = `Held by your custom shortcut “${named}” — Use releases it (restorable below).`;
            } else {
                const conflict = findConflict(preset.accel);
                row.subtitle = conflict ? `Conflict: ${conflict}` : 'No conflict found.';
            }
            const btn = new Gtk.Button({ label: 'Use', valign: Gtk.Align.CENTER });
            btn.connect('clicked', () => {
                // Taking over a custom shortcut is the one thing this page
                // ever writes outside Cliplet's own settings — explicit,
                // named in the row above, and restorable below.
                for (const holder of listCustomHolders(preset.accel))
                    recordReleased(this._settings, holder.path, releaseCustom(holder.path));
                this._settings.set_string(
                    preset.module === 'clipboard' ? 'shortcut-clipboard' : 'shortcut-emoji',
                    preset.accel);
                this._rebuildShortcutRows();
                this._rebuildReleasedRows();
            });
            row.add_suffix(btn);
            presets.add(row);
        }
        page.add(presets);

        this._releasedGroup = new Adw.PreferencesGroup({
            title: 'Released bindings',
            description: 'Custom shortcuts Cliplet released to take an accelerator. Restore puts the key back exactly as it was; our own chord is released first if it matches.',
        });
        page.add(this._releasedGroup);
        this._releasedRows = [];
        this._rebuildReleasedRows();
        return page;
    }

    _shortcutRow(title, key, module) {
        const row = new Adw.ActionRow({ title });
        const label = new Gtk.Label({
            label: this._prettyAccel(this._settings.get_string(key)),
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(label);

        const setBtn = new Gtk.Button({ label: 'Change…', valign: Gtk.Align.CENTER });
        setBtn.connect('clicked', () => this._captureAccelerator(title, (accel) => {
            this._settings.set_string(key, accel);
            label.label = this._prettyAccel(accel);
        }));
        row.add_suffix(setBtn);

        const noneBtn = new Gtk.Button({ label: 'None', valign: Gtk.Align.CENTER });
        noneBtn.connect('clicked', () => {
            this._settings.set_string(key, '');
            label.label = 'Disabled';
        });
        row.add_suffix(noneBtn);

        this._shortcutRows = this._shortcutRows || [];
        this._shortcutRows.push({ row, key, label });
        return row;
    }

    _rebuildShortcutRows() {
        for (const { key, label } of this._shortcutRows || []) {
            label.label = this._prettyAccel(this._settings.get_string(key));
        }
    }

    _prettyAccel(accel) {
        if (!accel) return 'Disabled';
        return accel
            .replace(/<Super>/g, 'Super+').replace(/<Control>/g, 'Ctrl+')
            .replace(/<Shift>/g, 'Shift+').replace(/<Alt>/g, 'Alt+')
            .replace(/period/g, '.');
    }

    _captureAccelerator(title, onSet) {
        const dialog = new Adw.Dialog({
            title: `Set shortcut — ${title}`,
            content_width: 420,
            content_height: 200,
        });
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
        });
        const status = new Gtk.Label({ label: 'Press the key combination…' });
        status.add_css_class('title-3');
        const note = new Gtk.Label({
            label: 'Escape cancels. Backspace clears the binding.',
            sensitive: false,
        });
        box.append(status);
        box.append(note);

        const controller = new Gtk.EventControllerKey();
        box.add_controller(controller);
        let captured = null;
        controller.connect('key-pressed', (c, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.force_close();
                return true;
            }
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_BackSpace && mods === 0) {
                onSet('');
                dialog.force_close();
                return true;
            }
            if (mods === 0) {
                status.label = 'Include a modifier (Super, Ctrl, Alt, Shift)…';
                return true;
            }
            captured = Gtk.accelerator_name(keyval, mods);
            status.label = this._prettyAccel(captured);
            const conflict = findConflict(captured);
            if (conflict) {
                status.label = `${this._prettyAccel(captured)} — conflict: ${conflict}`;
            }
            // Commit on the next Enter or immediately? Immediate is the
            // preset behaviour; keep immediate for review simplicity.
            onSet(captured);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
                dialog.force_close();
                return false;
            });
            return true;
        });

        dialog.child = box;
        dialog.present(this._window);
    }

    // Rows for every custom shortcut Cliplet released, each with a restore
    // button. Entries whose dconf path has since been deleted are dropped —
    // there is nothing left to put back.
    _rebuildReleasedRows() {
        for (const row of this._releasedRows || [])
            this._releasedGroup.remove(row);
        this._releasedRows = [];

        const validPaths = new Set();
        try {
            const base = Gio.Settings.new('org.gnome.settings-daemon.plugins.media-keys');
            for (const p of base.get_strv('custom-keybindings'))
                validPaths.add(p);
        } catch {
            // no media-keys schema — nothing can be restored
        }

        for (const [path, binding] of releasedList(this._settings)) {
            if (!validPaths.has(path)) {
                dropReleased(this._settings, path);
                continue;
            }
            let name = path;
            try {
                name = Gio.Settings.new_with_path(
                    'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
                    path).get_string('name') || path;
            } catch {
                // keep the path as the display name
            }

            const row = new Adw.ActionRow({
                title: name,
                subtitle: `was bound to ${binding}`,
            });
            const btn = new Gtk.Button({ label: 'Restore', valign: Gtk.Align.CENTER });
            btn.connect('clicked', () => {
                restoreCustom(path, binding);
                dropReleased(this._settings, path);
                // Releasing ours restores the previous behaviour instantly
                // (DR-11): the chord goes back to its original owner only.
                for (const key of ['shortcut-clipboard', 'shortcut-emoji']) {
                    if (this._settings.get_string(key) === binding)
                        this._settings.set_string(key, '');
                }
                this._rebuildReleasedRows();
                this._rebuildShortcutRows();
            });
            row.add_suffix(btn);
            this._releasedGroup.add(row);
            this._releasedRows.push(row);
        }
        this._releasedGroup.visible = this._releasedRows.length > 0;
    }

    _privacyPage() {
        const page = new Adw.PreferencesPage({ title: 'Privacy', icon_name: 'security-high-symbolic' });
        const group = new Adw.PreferencesGroup({ title: 'What Cliplet does with your clipboard' });

        const body = new Gtk.Label({
            label:
                'Cliplet reads your clipboard to build history. It runs inside GNOME Shell, ' +
                'so treat it as part of your desktop.\n\n' +
                'History is kept in memory and clears on logout or screen lock. By default ' +
                'nothing is written to disk; if you enable “Remember history between sessions” ' +
                'in Clipboard, text history is saved to ~/.config/cliplet/history.json — never ' +
                'possible secrets, never images.\n\n' +
                'Copies marked by password managers are never stored — including the re-offer ' +
                'the system emits when the password manager quits.\n\n' +
                'Cliplet makes no network requests.',
            wrap: true,
            xalign: 0,
            halign: Gtk.Align.FILL,
            margin_top: 6,
        });
        group.add(body);

        const review = new Adw.PreferencesGroup({
            title: 'Review build',
            description: 'Text-only capture (images deferred, D4) · Shell 50 · memory-only store · presets Super+V / Super+. pre-assigned for review',
        });
        page.add(group);
        page.add(review);
        return page;
    }
}
