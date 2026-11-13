// Cliplet — clipboard history + emoji picker in one popup shell.
// Review build: text-only capture (D4 deferred), memory-only store (D3),
// no network, no persistence, extension-only architecture (D6).
//
// enable()/disable() symmetry is the acceptance checklist (§4.5): every
// resource acquired here is released in disable().

import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { MemoryStore } from './src/store.js';
import { HistoryPersist } from './src/persist.js';
import { ClipboardCapture } from './src/capture.js';
import { KeybindingManager } from './src/keybindings.js';
import { Injector } from './src/injector.js';
import { EmojiModule } from './src/emojiModule.js';
import { PopupShell } from './src/popup.js';
import ClipletIndicator from './src/indicator.js';
import { Snippets } from './src/snippets.js';
import { Ocr } from './src/ocr.js';
import { JotPad } from './src/jot.js';
import { listCustomHolders, releaseCustom, recordReleased } from './src/conflictScan.js';

// gsd-media-keys releases a cleared custom binding asynchronously; retry a
// failed grab briefly before reporting a conflict (300/900/2000 ms).
const GRAB_RETRY_DELAYS_MS = [300, 900, 2000];

export default class ClipletExtension extends Extension {
    enable() {
        const settings = this.getSettings();
        this._settings = settings;
        this._grabSeq = 0;

        // store fires _dirty on every mutation; persistence debounces it
        this._store = new MemoryStore(settings.get_int('history-size'),
            () => this._persist?.schedule());
        this._persist = new HistoryPersist({ settings, store: this._store });
        if (settings.get_boolean('persist-history')) this._persist.load();

        // MultiCopy queue: session-transient — collecting state never
        // outlives the session, and queued clips are just text until merged.
        this._multicopy = { collecting: false, queue: [] };
        this._snippets = new Snippets();
        this._jot = new JotPad();
        this._ocr = new Ocr({
            settings,
            store: this._store,
            onToast: (message) => this._notify('Cliplet', message),
            onDone: () => this._popup?.open('clipboard', { keyboard: true }),
        });

        this._capture = new ClipboardCapture({
            settings,
            store: this._store,
            onChanged: () => this._popup?.refreshIfOpen(),
            multicopy: this._multicopy,
        });
        this._injector = new Injector({
            capture: this._capture,
            onFallback: (message) => this._notify('Cliplet', message),
        });
        this._emoji = new EmojiModule({ settings });
        this._keybindings = new KeybindingManager();
        this._keybindings.enable();

        this._popup = new PopupShell({
            settings,
            store: this._store,
            emoji: this._emoji,
            injector: this._injector,
            capture: this._capture,
            snippets: this._snippets,
            multicopy: this._multicopy,
            onOcr: () => this._ocr.start(),
        });

        this._popup.setModules({
            clipboard: settings.get_boolean('enable-clipboard'),
            emoji: settings.get_boolean('enable-emoji'),
        });

        // Clipboard module off => zero runtime footprint (§03.5, V10):
        // no selection connection, no store activity.
        if (settings.get_boolean('enable-clipboard')) {
            this._capture.enable();
            // S33 residual hole: re-enabling while a secret is on the
            // clipboard must re-arm the re-offer guard without reading it.
            this._capture.armReofferIfHinted();
        }
        this._injector.enable();

        // Panel indicator: the popup is reachable with no accelerator at all.
        this._indicator = new ClipletIndicator({
            settings,
            onOpen: (mode) => this._popup?.open(mode, { keyboard: false }),
            onPrefs: () => this._openPrefs(),
            onJot: () => this._jot.toggle(),
        });
        Main.panel.addToStatusArea('cliplet', this._indicator);

        this._grabShortcut('clipboard');
        this._grabShortcut('emoji');
        this._grabTool('ocr', () => this._ocr.start());
        this._grabTool('jot', () => this._jot.toggle());

        // live settings changes
        this._watchers = [
            settings.connect('changed::shortcut-clipboard', () => this._grabShortcut('clipboard')),
            settings.connect('changed::shortcut-emoji', () => this._grabShortcut('emoji')),
            settings.connect('changed::enable-clipboard', () => {
                if (settings.get_boolean('enable-clipboard')) {
                    this._capture.enable();
                    this._capture.armReofferIfHinted();
                } else {
                    this._capture.disable();
                }
                this._popup.setModules({
                    clipboard: settings.get_boolean('enable-clipboard'),
                    emoji: settings.get_boolean('enable-emoji'),
                });
            }),
            settings.connect('changed::enable-emoji', () => {
                this._popup.setModules({
                    clipboard: settings.get_boolean('enable-clipboard'),
                    emoji: settings.get_boolean('enable-emoji'),
                });
            }),
            settings.connect('changed::history-size', () => {
                this._store.setCapacity(settings.get_int('history-size'));
            }),
            settings.connect('changed::persist-history', () => {
                // on: restore now (dedupe makes it idempotent); off: the
                // file IS the residue — delete it
                if (settings.get_boolean('persist-history')) this._persist.load();
                else this._persist.clear();
            }),
            settings.connect('changed::compact-picker', () => this._popup?._applyCompact()),
            settings.connect('changed::shortcut-ocr', () => this._grabTool('ocr', () => this._ocr.start())),
            settings.connect('changed::shortcut-jot', () => this._grabTool('jot', () => this._jot.toggle())),
        ];
    }

    disable() {
        for (const id of this._watchers || []) {
            this._settings.disconnect(id);
        }
        this._watchers = [];

        this._indicator?.destroy();
        this._indicator = null;

        this._keybindings?.disable();
        this._keybindings = null;

        // Extensions are disabled on lock screen (§4.5): release everything,
        // then rebuild on enable — with persistence on, this is exactly the
        // moment the session's history is flushed to disk (lock = save).
        if (this._settings.get_boolean('persist-history')) this._persist?.save();
        this._persist?.destroy();
        this._persist = null;
        this._popup?.destroy();
        this._popup = null;
        this._injector?.disable();
        this._injector = null;
        this._capture?.disable();
        this._capture = null;
        this._store?.dispose();
        this._store = null;
        this._emoji = null;
        this._multicopy = null;
        this._snippets = null;
        this._ocr?.destroy();
        this._ocr = null;
        this._jot?.destroy();
        this._jot = null;
        this._settings = null;
    }

    // Generic tool accelerators (docs/15 §3): same grab machinery as the
    // module shortcuts, keyed by tool id instead of popup mode.
    _grabTool(id, onActivate) {
        const key = `shortcut-${id}`;
        const accel = this._settings.get_string(key);
        this._keybindings.grab(`tool-${id}`, accel, onActivate);
    }

    _openPrefs() {
        Main.extensionManager.openExtensionPrefs(this.uuid, '', {});
    }

    // Notification with optional action buttons (MessageTray system source).
    _notify(title, body, actions = []) {
        const notification = new MessageTray.Notification({
            source: MessageTray.getSystemSource(),
            title,
            body,
        });
        for (const [label, cb] of actions)
            notification.addAction(label, cb);
        MessageTray.getSystemSource().addNotification(notification);
    }

    // Grab (with brief retries for a just-released owner) and report the
    // final outcome: via onSettled when the caller wants custom reporting,
    // otherwise as an actionable notification.
    _grabShortcut(id, onSettled = null) {
        const key = id === 'clipboard' ? 'shortcut-clipboard' : 'shortcut-emoji';
        const accel = this._settings.get_string(key);
        if (!accel) return;

        const onActivate = () => {
            // DR-11: a module whose accelerator fires lands in its own mode.
            this._popup?.open(id, { keyboard: true });
        };

        // A stale retry never fires because the sequence token moved on.
        const seq = ++this._grabSeq;
        const settle = (result) => {
            if (onSettled) onSettled(accel, result);
            else this._reportGrab(id, accel, result);
        };
        const attempt = (i) => {
            if (seq !== this._grabSeq) return;
            const result = this._keybindings.grab(id, accel, onActivate);
            if (result.ok || i >= GRAB_RETRY_DELAYS_MS.length) {
                settle(result);
                return;
            }
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, GRAB_RETRY_DELAYS_MS[i], () => {
                attempt(i + 1);
                return GLib.SOURCE_REMOVE;
            });
        };
        attempt(0);
    }

    // Default grab report: an honest failure naming the owner when it can
    // be named, with the takeover offer attached when it is a custom
    // shortcut the user can release.
    _reportGrab(id, accel, result) {
        if (result.ok) {
            if (result.conflict) {
                this._notify('Cliplet',
                    `${accel}: ${result.conflict}. Cliplet bound it anyway — change in Preferences → Shortcuts if that was wrong.`);
            }
            return;
        }
        const actions = [['Open Preferences', () => this._openPrefs()]];
        const holders = listCustomHolders(accel);
        if (holders.length) {
            actions.unshift(['Take over', () => this._takeOver(id, accel)]);
            const named = holders.map(h => h.name || h.path).join(', ');
            this._notify('Cliplet',
                `Could not bind ${accel} — your custom shortcut "${named}" owns it. Take over, or change it in Preferences → Shortcuts.`,
                actions);
        } else {
            const conflict = result.conflict ?? 'another component owns this accelerator';
            this._notify('Cliplet',
                `Could not bind ${accel} — ${conflict}. Change it in Preferences → Shortcuts.`,
                actions);
        }
    }

    // Explicit, reversible takeover (V0b honesty): release the *named*
    // custom shortcuts holding this chord, remember each previous binding
    // for restoration in Preferences → Shortcuts, then take the chord.
    // Nothing is guessed — this only ever runs with a holder identified,
    // and only from an action the user clicked.
    _takeOver(id, accel) {
        const holders = listCustomHolders(accel);
        if (!holders.length) return;

        for (const holder of holders)
            recordReleased(this._settings, holder.path, releaseCustom(holder.path));

        const named = holders.map(h => h.name || h.path).join(', ');
        this._grabShortcut(id, (released, result) => {
            if (result.ok) {
                this._notify('Cliplet',
                    `${released} now opens Cliplet. Your custom shortcut "${named}" was released — restore it in Preferences → Shortcuts if that was wrong.`);
            } else {
                this._notify('Cliplet',
                    `${released} is still held by "${named}" even after releasing it — change the shortcut in Preferences → Shortcuts.`);
            }
        });
    }
}
