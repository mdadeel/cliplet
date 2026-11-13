// The unified popup shell (R2/R3): one actor, one grab, two modes, fixed
// 520×540 window. Direction A "Continuation" — opaque Adwaita surfaces,
// raised selection with an accent bar, keycap footer, scroll contract with a
// 30px fade instead of a scrollbar.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MODIFIER_RELEASE_CAP_MS } from './injector.js';
import { TRANSFORMS } from './transforms.js';

const PANEL_W = 520;
const PANEL_H = 540;
const COMPACT_H = 400;   // quick-picker mode: list-only, no footer (§2.5)
const HEADER_H = 54;
const FOOTER_H = 44;
const BODY_H = PANEL_H - HEADER_H - FOOTER_H;
const FADE_H = 30;
const GRID_COLS = 10;
const SEARCH_DEBOUNCE_MS = 40;   // spec: 30–50 ms
const OPEN_ANIM_MS = 150;
const CLOSE_ANIM_MS = 100;
const TOAST_MS = 2600;
const GRID_CACHE_MAX = 12;       // LRU cap: each entry holds ~160 buttons

const ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800',
    orange: '#ed5b00', red: '#e62d42', pink: '#d56199', purple: '#9141ac',
    slate: '#6f8396',
};

const TYPE_ICONS = {
    link: 'web-browser-symbolic',
    folder: 'folder-symbolic',
    files: 'folder-open-symbolic',
    image: 'image-x-generic-symbolic',
    text: 'text-x-generic-symbolic',
    code: 'utilities-terminal-symbolic',
};

function relTime(ms) {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 10) return 'now';
    if (s < 60) return `${s} s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    return 'earlier';
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Section label for a day group: today/yesterday are words, older entries
// get their real date ("Mon 3 Nov") instead of a blanket "EARLIER".
function dayGroup(ms) {
    const d = new Date(ms);
    const now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = (day(now) - day(d)) / 86400000;
    if (diff < 1) return 'RECENT';
    if (diff < 2) return 'YESTERDAY';
    const label = `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
    return now.getFullYear() !== d.getFullYear() ? `${label} ${d.getFullYear()}` : label;
}

function kindOf(entry) {
    if (entry.kind) return entry.kind;          // 'files' from the capture gate
    const t = entry.text;
    if (/^(https?:\/\/|www\.)/i.test(t)) return 'link';
    if (/^(file:\/\/|\/)/.test(t) && t.split('\n').length > 1) return 'folder';
    if (/^(git |ssh-|ssh |sudo |docker |kubectl |npm |pip3? |make |curl |diff |patch )/.test(t))
        return 'code';
    return 'text';
}

function imageLabel(entry) {
    const size = entry.bytes?.get_size?.() ?? entry.bytes?.length ?? 0;
    const kb = Math.max(1, Math.round(size / 1024));
    const fmt = (entry.mime || 'image/png').split('/')[1]?.toUpperCase() || 'IMAGE';
    return `Image · ${fmt} · ${kb} KB`;
}

// A short human label for file rows: first basename, "+N more".
function fileLabel(entry) {
    const uris = entry.text.split('\n').filter(Boolean);
    const base = (uri) => decodeURIComponent(uri.replace(/^file:\/\//, '')
        .replace(/\/$/, '').split('/').pop() || uri);
    return uris.length === 1 ? base(uris[0]) : `${base(uris[0])} +${uris.length - 1} more`;
}

// Modal event delivery in Shell 50 goes through vfuncs on a registered
// subclass (the ModalDialog pattern) — signal connects on a plain St.Widget
// cannot receive pushed-modal events.
const ClipletRoot = GObject.registerClass({
    GTypeName: 'ClipletRoot',
}, class ClipletRoot extends St.Widget {
    vfunc_captured_event(event) {
        return this._handler ? this._handler(event) : Clutter.EVENT_PROPAGATE;
    }
    // Target-phase delivery: consuming a chrome-drag press in the capture
    // handler makes Clutter implicit-grab the pointer ON THIS ACTOR — the
    // following motion/release events are targeted here directly and never
    // traverse the capture phase again. Route an active drag from here.
    vfunc_motion_event(event) {
        return this._directHandler ? this._directHandler(event) : Clutter.EVENT_PROPAGATE;
    }
    vfunc_button_release_event(event) {
        return this._directHandler ? this._directHandler(event) : Clutter.EVENT_PROPAGATE;
    }
});

// Fixed-size contract (R3), enforced at the actor level: the panel is a
// GObject subclass whose allocate/get_preferred vfuncs pin it to the
// 520×540 budget. Without this, the first emoji-mode relayout can leave a
// stale near-fullscreen allocation behind (the BinLayout only re-allocates
// on invalidation, so one bad pass sticks) — and content minimums from the
// grid can inflate a plain fixed-size request.
// Event-vfunc actors (Shell 50): connecting button-press/motion/scroll
// *signals* on plain St.Widgets throws "Virtual function not implemented"
// on EVERY event — an exception per mouse move, which read as "the
// extension is slow". All event handling goes through these vfunc classes.
const ClipletScrollView = GObject.registerClass({
    GTypeName: 'ClipletScrollView',
}, class ClipletScrollView extends St.ScrollView {
    vfunc_scroll_event(event) {
        return this._onScroll ? this._onScroll(this, event) : Clutter.EVENT_PROPAGATE;
    }
});

const ClipletRow = GObject.registerClass({
    GTypeName: 'ClipletRow',
}, class ClipletRow extends St.BoxLayout {
    vfunc_button_press_event(event) {
        return this._onPress ? this._onPress(this, event) : Clutter.EVENT_PROPAGATE;
    }
});

const ClipletCell = GObject.registerClass({
    GTypeName: 'ClipletCell',
}, class ClipletCell extends St.Button {
    vfunc_button_press_event(event) {
        return this._onRightClick ? this._onRightClick(this, event) : Clutter.EVENT_PROPAGATE;
    }
});

const ClipletPanel = GObject.registerClass({
    GTypeName: 'ClipletPanel',
}, class ClipletPanel extends St.BoxLayout {
    // compact quick-picker height (§2.5); set by the shell when the setting
    // changes and read by the fixed-size vfuncs below.
    _compactHeight() {
        return this.compact ? COMPACT_H : PANEL_H;
    }
    vfunc_get_preferred_width(_forHeight) {
        return [PANEL_W, PANEL_W];
    }
    vfunc_get_preferred_height(_forWidth) {
        const h = this._compactHeight();
        return [h, h];
    }
    vfunc_allocate(box) {
        const fixed = new Clutter.ActorBox({
            x1: box.x1, y1: box.y1,
            x2: box.x1 + PANEL_W, y2: box.y1 + this._compactHeight(),
        });
        super.vfunc_allocate(fixed);
    }
});

export class PopupShell {
    constructor({ settings, store, emoji, injector, capture, snippets = null, multicopy = null, onOcr = null }) {
        this._settings = settings;
        this._store = store;
        this._emoji = emoji;
        this._injector = injector;
        this._capture = capture;
        this._snippets = snippets;       // Snippets instance or null
        this._multicopy = multicopy;     // {collecting, queue} or null
        this._onOcr = onOcr;             // () => void — start OCR capture

        this._built = false;
        this._isOpen = false;
        this._grab = null;
        this._mode = 'clipboard';
        this._openSource = 'pointer';
        this._selectedId = null;      // entry id, stable across rebuilds
        this._flatRows = [];          // [{kind:'label', text} | {kind:'entry', entry}]
        this._entryRows = [];         // visible entry rows in list order
        this._searchDebounceId = 0;
        this._toastId = 0;
        this._closeAfter = null;
        this._releaseTimerId = 0;
        this._heldMods = new Set();
        this._category = 'smileys';
        this._emojiSel = 0;
        this._gridEntries = [];
        this._gridCache = new Map();
        this._rowPool = new Map();      // key -> built row actor (search reuse)
        this._lastRowActor = null;      // O(1) list selection repaint
        this._lastSelectedCell = null;  // O(1) grid selection repaint
        this._ifaceWatchers = [];
        this._actionActors = new Set();
        this._accent = ACCENTS.blue;
        this._settingsWatchers = [];
        this._drag = null;
        this._dragFilterId = 0;
        this._compact = false;
    }

    setModules({ clipboard, emoji }) {
        this._clipboardEnabled = clipboard;
        this._emojiEnabled = emoji;
        if (this._built) {
            this._segment.visible = clipboard && emoji;
            this._segmentClipboard.visible = clipboard;
            this._segmentEmoji.visible = emoji;
        }
        if (this._isOpen) {
            if (this._mode === 'clipboard' && !clipboard) this._setMode('emoji');
            else if (this._mode === 'emoji' && !emoji) this._setMode('clipboard');
            else this._setMode(this._mode);
        }
    }

    // ---------- build ----------

    _ensureBuilt() {
        if (this._built) return;

        // Theme settings are read by _applyTheme() even on a failed build.
        this._iface = Gio.Settings.new('org.gnome.desktop.interface');
        // Live theme/accent: the panel follows the system while it is open,
        // like every first-class GNOME surface.
        this._ifaceWatchers = [
            this._iface.connect('changed::color-scheme', () => this._onThemeChanged()),
            this._iface.connect('changed::accent-color', () => this._onThemeChanged()),
        ];

        this._root = new ClipletRoot({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            x: 0, y: 0,
            style: 'background-color: transparent;',
        });
        this._root._handler = (event) => this._onCaptured(event);
        this._root._directHandler = (event) => this._onDirectEvent(event);
        this._panel = new ClipletPanel({
            vertical: true,
            style_class: 'cliplet-shell',
        });
        this._root.add_child(this._panel);

        this._buildHeader();
        this._buildBodies();
        this._buildFooter();

        Main.layoutManager.uiGroup.add_child(this._root);
        this._root.hide();
        this._built = true;
    }

    _buildHeader() {
        // Fixed window budget (R3): 54 header + 442 body + 44 footer = 540.
        // Explicit heights keep the content minimum from inflating the panel.
        this._header = new St.BoxLayout({ style_class: 'cliplet-header', height: HEADER_H });
        this._panel.add_child(this._header);

        // drag grip (the whole header chrome drags, minus the entry and the
        // segment switch — the grip just makes that discoverable)
        this._header.add_child(new St.Label({
            text: '···',
            style_class: 'cliplet-grip',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        // search: magnifier + entry on one quiet line (design: no pill bg)
        const searchArea = new St.BoxLayout({ x_expand: true });
        searchArea.add_child(new St.Icon({
            icon_name: 'edit-find-symbolic',
            style_class: 'cliplet-search-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._entry = new St.Entry({
            style_class: 'cliplet-search',
            hint_text: 'Search clipboard',
            can_focus: true,
            x_expand: true,
        });
        this._entry.get_clutter_text().set_single_line_mode(true);
        searchArea.add_child(this._entry);
        this._header.add_child(searchArea);
        this._entry.connect('notify::text', () => this._onSearchChanged());

        this._segment = new St.BoxLayout({ style_class: 'cliplet-segment' });
        this._header.add_child(this._segment);

        const mkSegment = (iconName, label) => {
            const btn = new St.Button({
                style_class: 'cliplet-segment-button',
                reactive: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const box = new St.BoxLayout({ style: 'spacing: 6px;' });
            box.add_child(new St.Icon({ icon_name: iconName, icon_size: 14, y_align: Clutter.ActorAlign.CENTER }));
            box.add_child(new St.Label({ text: label, y_align: Clutter.ActorAlign.CENTER }));
            btn.set_child(box);
            return btn;
        };
        this._segmentClipboard = mkSegment('edit-paste-symbolic', 'Clipboard');
        this._segmentEmoji = mkSegment('face-smile-symbolic', 'Emoji');
        this._segment.add_child(this._segmentClipboard);
        this._segment.add_child(this._segmentEmoji);
        this._segmentClipboard.connect('clicked', () => this._setMode('clipboard'));
        this._segmentEmoji.connect('clicked', () => this._setMode('emoji'));
    }

    // Scroll contract (R3): no scrollbar. With vscrollbar policy NEVER,
    // St.ScrollView never creates its scrollbar — and its built-in wheel
    // handling lives on that scrollbar — so wheel events would do nothing.
    // Scroll the viewport adjustment ourselves instead.
    _makeScrollList() {
        const scroll = new ClipletScrollView({
            x_expand: true,
            y_expand: true,
        });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.NEVER);
        scroll._onScroll = (actor, event) => this._onScroll(actor, event);
        return scroll;
    }

    _onScroll(actor, event) {
        const adj = actor.vadjustment;
        if (!adj) return Clutter.EVENT_PROPAGATE;
        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            if (dy === 0) return Clutter.EVENT_STOP;
            adj.value = this._clampScroll(adj, adj.value + dy * 64);
            return Clutter.EVENT_STOP;
        }
        const step = dir === Clutter.ScrollDirection.DOWN ? 1 : dir === Clutter.ScrollDirection.UP ? -1 : 0;
        if (!step) return Clutter.EVENT_PROPAGATE;
        adj.value = this._clampScroll(adj, adj.value + step * 78);   // 1.5 rows
        return Clutter.EVENT_STOP;
    }

    _clampScroll(adj, value) {
        return Math.max(adj.lower, Math.min(adj.upper - adj.page_size, value));
    }

    _buildBodies() {
        // clip: the emoji grid's content minimum can exceed the body — a
        // vertical BoxLayout would overflow past the footer without clipping
        this._stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            height: this._bodyHeight(),
            clip_to_allocation: true,
        });
        this._panel.add_child(this._stack);

        // ----- clipboard body -----
        this._clipBody = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true });
        this._stack.add_child(this._clipBody);

        this._clipScroll = this._makeScrollList();
        this._clipBody.add_child(this._clipScroll);

        // The ScrollView's child must implement St.Scrollable — St.Viewport,
        // not a plain BoxLayout (otherwise the adjustment never sees the
        // content size and nothing scrolls).
        this._clipList = new St.Viewport({
            layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation.VERTICAL }),
            style_class: 'cliplet-viewport',
        });
        this._clipScroll.set_child(this._clipList);

        this._fade = new St.Widget({
            style_class: 'cliplet-fade',
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
        });
        this._clipBody.add_child(this._fade);

        // empty state
        this._emptyBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true,
            style: 'padding: 0 60px;',
        });
        const emptyIcon = new St.Icon({
            icon_name: 'edit-copy-symbolic',
            icon_size: 42,
            style_class: 'cliplet-empty-icon',
        });
        this._emptyTitle = new St.Label({ style_class: 'cliplet-empty', x_align: Clutter.ActorAlign.CENTER });
        this._emptySub = new St.Label({
            style_class: 'cliplet-empty-sub',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._emptySub.get_clutter_text().set_line_wrap(true);
        this._emptyBox.add_child(emptyIcon);
        this._emptyBox.add_child(this._emptyTitle);
        this._emptyBox.add_child(this._emptySub);
        this._clipBody.add_child(this._emptyBox);
        this._emptyBox.hide();

        // ----- emoji body -----
        this._emojiBody = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
        this._stack.add_child(this._emojiBody);

        this._rail = new St.BoxLayout({ style_class: 'cliplet-rail' });
        this._emojiBody.add_child(this._rail);
        this._railButtons = new Map();
        for (const cat of this._emoji.categories) {
            // icon-only rail (Windows-style): frees width for the tone strip
            // and vertical space for the grid
            const btn = new St.Button({
                style_class: 'cliplet-rail-button',
                reactive: true,
                y_align: Clutter.ActorAlign.CENTER,
                accessible_name: cat.label,
            });
            btn.child = new St.Label({
                text: cat.glyph,
                style_class: 'cliplet-rail-glyph',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.connect('clicked', () => {
                this._category = cat.id;
                this._emojiSel = 0;
                this._refreshEmoji();
            });
            this._rail.add_child(btn);
            this._railButtons.set(cat.id, btn);
        }

        // skin-tone strip lives at the end of the rail — the tone is a
        // top-level picker in Windows' panel, not a buried menu item
        const railSpacer = new St.Widget({ x_expand: true });
        this._rail.add_child(railSpacer);
        this._toneStrip = new St.BoxLayout({ style: 'spacing: 4px;' });
        this._rail.add_child(this._toneStrip);
        this._buildToneStrip();

        // recents band on a raised plate (Directive 2)
        this._recentsPlate = new St.BoxLayout({
            vertical: true,
            style_class: 'cliplet-recents-plate',
            x_align: Clutter.ActorAlign.FILL,
        });
        this._favSection = new St.BoxLayout({
            vertical: true, style_class: 'cliplet-recents-plate',
            x_align: Clutter.ActorAlign.FILL,
        });
        this._favSection.add_child(new St.Label({
            style_class: 'cliplet-section', text: 'FAVOURITES',
        }));
        this._favRow = new St.BoxLayout({ style: 'spacing: 2px; padding: 0 4px;' });
        this._favSection.add_child(this._favRow);
        this._favSection.hide();
        this._emojiBody.add_child(this._favSection);

        const recentsHead = new St.BoxLayout();
        const recentsLabel = new St.Label({
            style_class: 'cliplet-section', text: 'RECENT', x_expand: true,
        });
        recentsLabel.get_clutter_text().ellipsize = Pango.EllipsizeMode.NONE;
        recentsHead.add_child(recentsLabel);
        recentsHead.add_child(new St.Label({
            text: 'tap to insert at the cursor',
            style_class: 'cliplet-section-hint',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._recentsPlate.add_child(recentsHead);
        this._recentsRow = new St.BoxLayout({ style: 'spacing: 2px; padding: 0 4px;' });
        this._recentsPlate.add_child(this._recentsRow);
        this._emojiBody.add_child(this._recentsPlate);

        // section header above the grid: category + "all N · ←→ to browse"
        this._gridSection = new St.BoxLayout({ style_class: 'cliplet-section-row' });
        this._gridSectionLabel = new St.Label({
            style_class: 'cliplet-section', text: '', x_expand: true,
        });
        this._gridSectionLabel.get_clutter_text().ellipsize = Pango.EllipsizeMode.NONE;
        this._gridSectionMeta = new St.Label({
            style_class: 'cliplet-section-meta',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._gridSection.add_child(this._gridSectionLabel);
        this._gridSection.add_child(this._gridSectionMeta);
        this._emojiBody.add_child(this._gridSection);

        this._gridScroll = this._makeScrollList();
        this._emojiBody.add_child(this._gridScroll);
        this._grid = new St.Viewport({
            layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation.VERTICAL }),
            style: 'padding: 4px 6px;',
        });
        this._gridScroll.set_child(this._grid);

        // ----- overlays: tone popover + overflow menu -----
        this._tonePop = new St.BoxLayout({
            style_class: 'cliplet-tone-pop',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            style: 'margin-bottom: 56px;',
        });
        this._stack.add_child(this._tonePop);
        this._tonePop.hide();

        this._menu = new St.BoxLayout({
            vertical: true,
            style_class: 'cliplet-menu',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            style: 'margin-right: 10px; margin-bottom: 52px;',
        });
        this._stack.add_child(this._menu);
        this._menu.hide();
    }

    _buildFooter() {
        this._footer = new St.BoxLayout({ style_class: 'cliplet-footer', height: FOOTER_H });
        this._panel.add_child(this._footer);

        // hints and toasts stack on the same spot (BinLayout): the footer
        // never changes height when a toast appears.
        const hintStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._footerHints = new St.BoxLayout({ style_class: 'cliplet-footer-hint' });
        hintStack.add_child(this._footerHints);
        this._toast = new St.Label({
            style_class: 'cliplet-toast',
            y_align: Clutter.ActorAlign.CENTER,
        });
        hintStack.add_child(this._toast);
        this._toast.hide();
        this._footer.add_child(hintStack);

        const spacer = new St.Widget({ x_expand: true });
        this._footer.add_child(spacer);

        this._count = new St.Label({ style_class: 'cliplet-count', y_align: Clutter.ActorAlign.CENTER });
        this._footer.add_child(this._count);

        this._overflowBtn = new St.Button({
            style_class: 'cliplet-overflow',
            child: new St.Icon({ icon_name: 'view-more-symbolic', icon_size: 16 }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._footer.add_child(this._overflowBtn);
        this._overflowBtn.connect('clicked', () => this._toggleMenu());
    }

    // Body height tracks the panel mode: quick-picker (§2.5) drops the
    // footer entirely and shrinks the body to the leftover.
    _bodyHeight() {
        return this._compact ? COMPACT_H - HEADER_H : BODY_H;
    }

    _applyCompact() {
        if (!this._built) return;
        this._compact = this._settings.get_boolean('compact-picker');
        this._panel.compact = this._compact;
        this._footer.visible = !this._compact;
        this._stack.height = this._bodyHeight();
        this._panel.queue_relayout();
    }

    _keycapHints(pairs) {
        this._footerHints.remove_all_children();
        for (const [key, label] of pairs) {
            this._footerHints.add_child(new St.Label({
                text: key,
                style_class: 'cliplet-keycap',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            this._footerHints.add_child(new St.Label({
                text: label,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
    }

    // ---------- open / close ----------

    open(mode = null, { keyboard = false } = {}) {
        this._ensureBuilt();
        if (this._isOpen) {
            if (mode && mode !== this._mode) this._setMode(mode);
            return;
        }
        this._openSource = keyboard ? 'keyboard' : 'pointer';
        this._recorded = this._injector.recordFocus();

        this._applyTheme();
        this._applyCompact();
        this._store.setCapacity(this._settings.get_int('history-size'));

        const requested = mode || this._settings.get_string('last-mode') || 'clipboard';
        const initial = requested === 'emoji' && this._emojiEnabled ? 'emoji' : 'clipboard';
        if (!this._clipboardEnabled) this._setMode('emoji');
        else this._setMode(initial);

        this._entry.text = '';
        this._entry.grab_key_focus();

        const monitor = this._monitorForPointer();
        this._root.set_position(monitor.x, monitor.y);
        this._root.set_size(monitor.width, monitor.height);
        this._positionPanel(monitor);

        this._root.show();
        this._panel.show();
        this._animateOpen();
        this._grab = Main.pushModal(this._root, { actionMode: Shell.ActionMode.ALL });
        this._isOpen = true;
        this._heldMods.clear();
        this._settings.set_string('last-mode', this._mode);
    }

    // Windows-grade entrance: fade + slight scale from the anchor edge
    // (pivot at top centre, where the pointer/hotkey "issued" it).
    _animateOpen() {
        this._panel.set_pivot_point(0.5, 0.0);
        this._panel.opacity = 0;
        this._panel.scale_x = 0.96;
        this._panel.scale_y = 0.96;
        this._panel.ease({
            duration: OPEN_ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
        });
    }

    // Exit animation only when nothing must happen afterwards: the paste
    // path keeps its instant hide so injected chords are not delayed.
    _animateClose(onDone) {
        this._panel.ease({
            duration: CLOSE_ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            opacity: 0,
            scale_x: 0.97,
            scale_y: 0.97,
            onComplete: onDone,
        });
    }

    // popovers (menu, tone strip popover) fade in instead of popping in
    _showPopover(actor) {
        actor.show();
        actor.opacity = 0;
        actor.ease({
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            opacity: 255,
        });
    }

    close(after = null) {
        if (!this._isOpen) {
            after?.();
            return;
        }
        this._isOpen = false;
        this._closeAfter = after;
        this._drag = null;
        this._stopDragFilter();
        this._cancelSearchDebounce();
        this._clearFlash();
        this._tonePop.hide();
        this._menu.hide();
        if (this._toastId) {
            GLib.source_remove(this._toastId);
            this._toastId = 0;
        }
        this._toast?.hide();
        const finish = () => {
            this._panel.hide();
            this._panel.opacity = 255;
            this._panel.scale_x = 1.0;
            this._panel.scale_y = 1.0;
            this._maybeFinishClose();
        };
        if (after) {
            // paste/insert path: no animation, the chord must not wait
            this._panel.hide();
            this._maybeFinishClose();
        } else {
            this._animateClose(finish);
        }
    }

    _maybeFinishClose() {
        // S28: if the user still holds the opening modifier (Super+V, Enter
        // fast), hold the modal until release, capped at 600 ms, so the
        // injected chord is not polluted by Super.
        if (this._heldMods.size > 0 && !this._releaseTimerId) {
            this._releaseTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MODIFIER_RELEASE_CAP_MS, () => {
                this._releaseTimerId = 0;
                this._heldMods.clear();
                this._maybeFinishClose();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        if (this._releaseTimerId) {
            GLib.source_remove(this._releaseTimerId);
            this._releaseTimerId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        // The search entry keeps Clutter key focus after the modal releases
        // (meta focus never moved, so nothing re-assigns it): every key —
        // including the injected paste chord — would route into the hidden
        // entry and vanish instead of reaching the focused window.
        global.stage.set_key_focus(null);
        this._root.hide();
        const after = this._closeAfter;
        this._closeAfter = null;
        after?.();
    }

    refreshIfOpen() {
        if (this._isOpen && this._mode === 'clipboard') this._refreshClipboard();
    }

    destroy() {
        // a no-op callback forces close() down the instant (non-animated)
        // path so the modal grab is released before the root is destroyed
        if (this._isOpen) this.close(() => {});
        this._drag = null;
        this._stopDragFilter();
        if (this._built) {
            for (const id of this._ifaceWatchers) this._iface.disconnect(id);
            this._ifaceWatchers = [];
            this._root.destroy();
            this._built = false;
            // detached cached actors are not under _root: free them too
            for (const rows of this._gridCache.values())
                for (const r of rows) r.destroy();
            this._gridCache.clear();
            for (const row of this._rowPool.values()) row.destroy();
            this._rowPool.clear();
            this._lastRowActor = null;
            this._lastSelectedCell = null;
            this._flashActor = null;
        }
        this._cancelSearchDebounce();
        if (this._toastId) {
            GLib.source_remove(this._toastId);
            this._toastId = 0;
        }
    }

    // ---------- theme ----------

    _applyTheme() {
        const scheme = this._iface.get_string('color-scheme');
        const dark = scheme === 'prefer-dark';
        const accentKey = this._iface.get_string('accent-color') || 'blue';
        this._accent = ACCENTS[accentKey] || ACCENTS.blue;
        this._panel.style_class = `cliplet-shell ${dark ? 'cliplet-dark' : 'cliplet-light'}`;
        this._dark = dark;
    }

    _onThemeChanged() {
        const was = this._accent;
        this._applyTheme();
        if (this._accent === was && this._dark === this._lastDark) return;
        this._lastDark = this._dark;
        // repaint accent surfaces built at row-creation time
        for (const row of this._rowPool.values())
            row._accentBar?.set_style(`background-color: ${this._accent};`);
        if (this._isOpen) {
            this._updateToneStrip();
            this._selectEmoji(this._emojiSel, { scroll: false });
            this._setMode(this._mode);
        }
    }

    // ---------- positioning ----------

    _monitorForPointer() {
        try {
            const [px, py] = global.get_pointer();
            const index = global.display.get_current_monitor();
            const monitor = Main.layoutManager.monitors[index] || Main.layoutManager.primaryMonitor;
            return { ...monitor, px, py };
        } catch {
            const monitor = Main.layoutManager.primaryMonitor;
            return { ...monitor, px: monitor.x + monitor.width / 2, py: monitor.y + monitor.height / 2 };
        }
    }

    _positionPanel(monitor) {
        const wa = Main.layoutManager.getWorkAreaForMonitor(monitor.index) || monitor;
        const height = this._compact ? COMPACT_H : PANEL_H;
        const savedX = this._settings.get_int('popup-x');
        const savedY = this._settings.get_int('popup-y');
        let x, y;
        if (savedX >= 0 && savedY >= 0) {
            // remembered (dragged) position — root-relative, so stage position
            // = saved + monitor origin, clamped to this monitor's workarea
            x = Math.max(wa.x + 8, Math.min(savedX + monitor.x, wa.x + wa.width - PANEL_W - 8));
            y = Math.max(wa.y + 8, Math.min(savedY + monitor.y, wa.y + wa.height - height - 8));
        } else {
            x = monitor.px - PANEL_W / 2;
            y = monitor.py + 12;
            if (y + height > wa.y + wa.height) y = monitor.py - height - 12;
            x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - PANEL_W - 8));
            y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - height - 8));
        }
        // panel.x/y are ROOT-relative — the root sits at the monitor origin,
        // so the stage-absolute (x, y) must be translated back (on a secondary
        // monitor the old code double-offset the panel off screen).
        this._panel.set_position(x - monitor.x, y - monitor.y);
    }

    // ---------- modes ----------

    _setMode(mode) {
        this._mode = mode;
        if (!this._built) return;
        this._clipBody.visible = mode === 'clipboard';
        this._emojiBody.visible = mode === 'emoji';
        if (mode === 'clipboard') {
            this._segmentClipboard.add_style_class_name('cliplet-active');
            this._segmentEmoji.remove_style_class_name('cliplet-active');
        } else {
            this._segmentEmoji.add_style_class_name('cliplet-active');
            this._segmentClipboard.remove_style_class_name('cliplet-active');
        }

        if (mode === 'clipboard') {
            this._entry.hint_text = 'Search clipboard';
            this._keycapHints([
                ['↑↓', 'Navigate'], ['↵', 'Paste'], ['P', 'Pin'], ['Tab', 'Emoji'],
            ]);
            this._refreshClipboard();
        } else {
            this._entry.hint_text = 'Search emoji';
            this._keycapHints([
                ['↑↓←→', 'Move'], ['↵', 'Insert'], ['Ctrl+↵', 'Copy'], ['Tab', 'Clipboard'],
            ]);
            this._refreshEmoji();
        }
        if (this._isOpen) this._settings.set_string('last-mode', mode);
    }

    // ---------- search ----------

    _onSearchChanged() {
        this._cancelSearchDebounce();
        this._searchDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
            this._searchDebounceId = 0;
            if (this._mode === 'clipboard') this._refreshClipboard();
            else this._refreshEmoji();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelSearchDebounce() {
        if (this._searchDebounceId) {
            GLib.source_remove(this._searchDebounceId);
            this._searchDebounceId = 0;
        }
    }

    // ---------- clipboard list ----------

    _refreshClipboard() {
        if (!this._built) return;
        const query = this._entry.text;
        const result = this._store.search(query);
        const searching = query.trim().length > 0;

        this._clipList.remove_all_children();
        this._flatRows = [];
        this._entryRows = [];
        const seen = new Set();

        const addLabel = (text, meta) => {
            const box = new St.BoxLayout({ style_class: 'cliplet-section-row' });
            const label = new St.Label({ style_class: 'cliplet-section', text, x_expand: !meta });
            label.get_clutter_text().ellipsize = Pango.EllipsizeMode.NONE;
            box.add_child(label);
            if (meta) {
                box.add_child(new St.Label({
                    text: meta, style_class: 'cliplet-section-meta',
                    x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            this._clipList.add_child(box);
            this._flatRows.push({ kind: 'label', actor: box });
        };

        // Snippets (docs/15 §2.1): user-authored text, shown above history;
        // clicking one pastes it at the cursor without entering history.
        if (this._snippets) {
            const matches = this._snippets.search(query);
            if (matches.length > 0) {
                addLabel('SNIPPETS', `${matches.length}`);
                matches.forEach((s, i) => {
                    const key = `snippet:${s.name}`;
                    seen.add(key);
                    this._addEntryRow({
                        id: -1 - i,
                        text: s.text,
                        app: s.name,
                        time: 0,
                        masked: false,
                        truncated: false,
                    }, { snippet: true, key });
                });
            }
        }

        if (result.pins.length > 0) {
            addLabel('PINNED', `${result.pins.length}`);
            for (const entry of result.pins) {
                seen.add(`entry:${entry.id}`);
                this._addEntryRow(entry, { pinned: true });
            }
        }
        if (searching) {
            if (result.recent.length > 0) addLabel(`${result.recent.length + result.pins.length} RESULTS`);
        } else if (result.recent.length > 0) {
            let group = null;
            for (const entry of result.recent) {
                const g = dayGroup(entry.time);
                if (g !== group) {
                    group = g;
                    addLabel(g, g === 'RECENT' ? 'newest first' : null);
                }
                seen.add(`entry:${entry.id}`);
                this._addEntryRow(entry, { pinned: false });
            }
        }

        // rows no longer on screen are destroyed, not cached forever
        for (const [key, row] of this._rowPool) {
            if (!seen.has(key)) {
                for (const btn of row._actions.get_children()) this._actionActors.delete(btn);
                if (this._lastRowActor === row) this._lastRowActor = null;
                if (this._flashActor === row) this._flashActor = null;
                row.destroy();
                this._rowPool.delete(key);
            }
        }

        const shown = this._entryRows.length;
        const total = this._store.count;
        this._count.text = searching ? `${shown} match${shown === 1 ? '' : 'es'}` : `${shown} of ${total}`;
        if (this._multicopy && this._multicopy.collecting) {
            this._count.text += ` · collecting ${this._multicopy.queue.length}`;
        }

        // empty states (spec §8.2: centered in the body, no counter)
        if (total === 0 && !searching) {
            this._emptyTitle.text = 'No clipboard history yet';
            this._emptySub.text = 'Copy something and it will appear here. History is memory-only and clears on logout.';
            this._emptyBox.show();
            this._clipScroll.visible = false;
            this._fade.visible = false;
            this._count.text = '';
        } else if (shown === 0 && searching) {
            this._emptyTitle.text = 'No matches';
            this._emptySub.text = 'Nothing in the history matches your search.';
            this._emptyBox.show();
            this._clipScroll.visible = false;
            this._fade.visible = false;
        } else {
            this._emptyBox.hide();
            this._clipScroll.visible = true;
            this._fade.visible = true;
        }

        // selection: keep the previously selected entry if it survived
        let index = this._entryRows.findIndex((r) => r.entry.id === this._selectedId);
        if (index < 0) index = 0;
        this._selectIndex(index, { scroll: false });
    }

    // Row actors are pooled per entry id: search rebuilds re-key the same
    // buttons instead of constructing hundreds of actors per keystroke.
    // Dynamic bits (title, meta, pin marker, accent) are refreshed on reuse.
    _addEntryRow(entry, { pinned, snippet = false, key = null }) {
        const poolKey = key ?? `entry:${entry.id}`;
        const kind = kindOf(entry);
        const tile = kind === 'image' && !snippet;
        let row = this._rowPool.get(poolKey);
        if (row && row._layout !== (tile ? 'tile' : 'list')) {
            // layout changed (kind flipped); rebuild rather than mutate
            for (const btn of row._actions.get_children()) this._actionActors.delete(btn);
            if (this._lastRowActor === row) this._lastRowActor = null;
            row.destroy();
            this._rowPool.delete(poolKey);
            row = null;
        }
        const fresh = !row;
        if (fresh) {
            const params = {
                style_class: tile ? 'cliplet-row cliplet-row-tile' : 'cliplet-row cliplet-row-44',
                vertical: tile,
                reactive: true,
                track_hover: true,
            };
            if (!tile) params.y_align = Clutter.ActorAlign.CENTER;
            row = new ClipletRow(params);
            row._layout = tile ? 'tile' : 'list';
            // accent bar: vertical strip on list rows, horizontal line on tiles
            row._accentBar = tile
                ? new St.Widget({
                    style_class: 'cliplet-bar-h',
                    style: `background-color: ${this._accent};`,
                    x_expand: true,
                })
                : new St.Widget({
                    style_class: 'cliplet-bar',
                    style: `background-color: ${this._accent};`,
                });
            row.add_child(row._accentBar);

            if (tile) {
                // image entries render as full-width preview tiles (Windows
                // Win+V style) with the caption + actions on a bottom bar
                const thumb = this._thumbnailFor(entry);
                if (thumb) {
                    const [pw, ph] = entry._thumbSize ?? [1, 1];
                    const scale = Math.min(1, 488 / pw, 140 / ph);
                    const thumbActor = new St.Widget({
                        content: thumb,
                        width: Math.max(24, Math.round(pw * scale)),
                        height: Math.max(24, Math.round(ph * scale)),
                        x_align: Clutter.ActorAlign.CENTER,
                        style_class: 'cliplet-tile-thumb',
                    });
                    row.add_child(thumbActor);
                }
                const bottom = new St.BoxLayout({
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 6px;',
                });
                row.add_child(bottom);
                row._pinMarker = new St.Icon({
                    icon_name: 'view-pin-symbolic',
                    icon_size: 14,
                    style_class: 'cliplet-pin-marker',
                });
                bottom.add_child(row._pinMarker);
                row._collectMarker = new St.Icon({
                    icon_name: 'object-select-symbolic',
                    icon_size: 14,
                    style_class: 'cliplet-collect-marker',
                });
                bottom.add_child(row._collectMarker);
                row._title = new St.Label({ style_class: 'cliplet-row-meta', x_expand: true });
                row._title.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
                bottom.add_child(row._title);
                row._chip = null;
                row._meta = null;
                row._actionParent = bottom;
            } else {
                const chip = new St.Bin({
                    style_class: 'cliplet-chip',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                row._chip = chip;
                row.add_child(chip);

                const middle = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
                row.add_child(middle);
                row._title = new St.Label({ style_class: 'cliplet-row-title' });
                row._title.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
                middle.add_child(row._title);
                row._meta = new St.Label({ style_class: 'cliplet-row-meta' });
                row._meta.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
                middle.add_child(row._meta);

                row._pinMarker = new St.Icon({
                    icon_name: 'view-pin-symbolic',
                    icon_size: 14,
                    style_class: 'cliplet-pin-marker',
                });
                row.add_child(row._pinMarker);
                row._collectMarker = new St.Icon({
                    icon_name: 'object-select-symbolic',
                    icon_size: 14,
                    style_class: 'cliplet-collect-marker',
                });
                row.add_child(row._collectMarker);
                row._actionParent = row;
            }

            row._actions = new St.BoxLayout({
                style_class: 'cliplet-row-actions',
                y_align: Clutter.ActorAlign.CENTER,
            });
            row._actionParent.add_child(row._actions);
            const mkAction = (icon, name, cb) => {
                const btn = new St.Button({
                    style_class: 'cliplet-row-action',
                    child: new St.Icon({ icon_name: icon, icon_size: 13 }),
                    accessible_name: name,
                });
                btn.connect('clicked', () => cb());
                this._actionActors.add(btn);
                row._actions.add_child(btn);
                return btn;
            };
            row._mkAction = mkAction;
            // snippets: paste on click, copy on the action — they are not
            // history, so pin/delete do not apply (edit in Preferences).
            if (snippet) {
                mkAction('edit-copy-symbolic', 'Copy snippet', () => this._copyEntry(row.clipletEntry));
            } else {
                row._filesAction = mkAction('folder-open-symbolic', 'Reveal in Files', () =>
                    this._revealFiles(row.clipletEntry));
                mkAction('view-pin-symbolic', 'Pin / unpin', () => this._togglePin(row.clipletEntry));
                mkAction('edit-copy-symbolic', 'Copy', () => this._copyEntry(row.clipletEntry));
                mkAction('user-trash-symbolic', 'Delete', () => this._deleteEntry(row.clipletEntry));
            }

            row._onPress = (actor, event) => {
                // null source under the stage grab — resolve by picking (see
                // _eventSource); without it, clicks on row actions fell
                // through to activate the row itself
                const [hx, hy] = event.get_coords();
                const source = this._eventSource(event, hx, hy);
                if (this._actionActors.has(source)) return Clutter.EVENT_PROPAGATE;
                if (event.get_button() === 3) {
                    this._openRowMenu(row.clipletEntry, row);
                    return Clutter.EVENT_STOP;
                }
                // Ctrl+click multi-select (Windows collection-style): rows
                // join the MultiCopy queue; paste-all is in the ⋮ menu
                if (event.get_button() === 1 &&
                    (event.get_state() & Clutter.ModifierType.CONTROL_MASK) &&
                    row.clipletEntry.id > 0) {
                    this._toggleCollect(row.clipletEntry);
                    return Clutter.EVENT_STOP;
                }
                this._activateEntry(row.clipletEntry);
                return Clutter.EVENT_STOP;
            };
            // Windows behaviour: hovering a row moves the selection with it.
            row.connect('notify::hover', () => this._onRowHover(row));

            this._rowPool.set(poolKey, row);
        }

        row.clipletEntry = entry;
        // chip follows the entry's kind (a transform can turn text into a
        // link); rebuilt only on change, not on every refresh
        if (row._chip) {
            if (kind === 'image') {
                if (row._chipKind !== 'image') {
                    const thumb = this._thumbnailFor(entry);
                    row._chip.child = thumb
                        ? new St.Widget({ content: thumb, width: 44, height: 44 })
                        : new St.Icon({ icon_name: TYPE_ICONS.image, icon_size: 16 });
                    row._chipKind = 'image';
                }
            } else if (row._chipKind !== kind) {
                row._chip.child = new St.Icon({ icon_name: TYPE_ICONS[kind], icon_size: 16 });
                row._chipKind = kind;
            }
        }

        // dynamic bits: text may have been transformed, times move on
        const display = entry.masked ? '••••••••••••'
            : (kind === 'image' ? imageLabel(entry)
                : (kind === 'files' ? fileLabel(entry) : entry.text.replace(/\s+/g, ' ').trim()));
        const bits = snippet ? [entry.app || 'snippet']
            : [entry.app || 'Unknown app', relTime(entry.time)];
        if (entry.truncated) bits.push('truncated');
        if (entry.masked) bits.push('possible secret — revealed only on paste');
        if (row._layout === 'tile') {
            row._title.style_class = 'cliplet-row-meta';
            row._title.text = `${display} · ${bits.join(' · ')}`;
        } else {
            row._title.text = entry.masked || display.length > 0 ? display : ' ';
            row._title.style_class = `cliplet-row-title${kind === 'code' ? ' cliplet-mono' : ''}`;
            row._meta.text = bits.join(' · ');
        }
        row._pinMarker.visible = !!pinned;
        row._collectMarker.visible = !!(this._multicopy && this._multicopy.collecting &&
            this._multicopy.queue.some((q) => q._id === entry.id));
        if (row._filesAction) row._filesAction.visible = kind === 'files';
        row._accentBar.set_style(`background-color: ${this._accent};`);
        row.accessible_name = `${display} — ${bits.join(', ')}`;

        this._clipList.add_child(row);
        this._flatRows.push({ kind: 'entry', entry, actor: row });
        this._entryRows.push({ entry, actor: row });
    }

    _onRowHover(row) {
        if (!row.hover || !this._isOpen) return;
        const i = this._entryRows.findIndex((r) => r.actor === row);
        if (i >= 0 && i !== this._selectedIndex) this._selectIndex(i, { scroll: false });
    }

    _selectIndex(index, { scroll = true } = {}) {
        this._selectedIndex = index;
        // O(1) repaint: clear the previous row, style the new one — the
        // full-list walk did hundreds of style churns per arrow key.
        const prev = this._lastRowActor;
        const row = this._entryRows[index];
        const next = row?.actor ?? null;
        if (prev !== next) {
            if (prev) {
                prev.remove_style_class_name('cliplet-selected');
                prev.remove_style_pseudo_class('active');
            }
            if (next) {
                next.add_style_class_name('cliplet-selected');
                next.add_style_pseudo_class('active');
            }
            this._lastRowActor = next;
        }
        this._selectedId = row ? row.entry.id : null;
        if (scroll) this._scrollToSelection();
    }

    _scrollToSelection() {
        const adj = this._clipScroll.vadjustment;
        const row = this._entryRows[this._selectedIndex];
        if (!row || !adj) return;
        // Real allocation position (labels/snippets included), falling back
        // to the uniform pitch before the first allocation pass.
        const pitch = 46;   // 44px row + 2px margins
        const y = row.actor.has_allocation() ? row.actor.get_allocation_box().y1
            : this._selectedIndex * pitch;
        if (y < adj.value) adj.value = y;
        else if (y + pitch > adj.value + adj.page_size - FADE_H) adj.value = y + pitch - (adj.page_size - FADE_H);
    }

    _moveSelection(delta) {
        if (!this._entryRows.length) return;
        const next = Math.max(0, Math.min(this._entryRows.length - 1, this._selectedIndex + delta));
        if (next !== this._selectedIndex) this._selectIndex(next);
    }

    // ---------- emoji grid ----------

    _refreshEmoji() {
        if (!this._built) return;
        const query = this._entry.text;
        const searching = query.trim().length > 0;

        for (const [id, btn] of this._railButtons) {
            const active = !searching && id === this._category;
            if (active) btn.add_style_class_name('cliplet-active');
            else btn.remove_style_class_name('cliplet-active');
        }
        this._updateToneStrip();
        const favs = this._emoji.favourites();
        const recents = this._emoji.recents();
        this._recentsPlate.visible = !searching && (favs.length > 0 || recents.length > 0);

        // favourites band (mockup 11: above recents, starred cells)
        this._favRow.remove_all_children();
        for (const entry of favs) {
            this._favRow.add_child(this._makeCell(entry, { small: true, fixed: true }));
        }
        this._favSection.visible = !searching && favs.length > 0;

        // recents band
        this._recentsRow.remove_all_children();
        for (const entry of recents) {
            this._recentsRow.add_child(this._makeCell(entry, { small: true, fixed: true }));
        }

        // The scroll's minimum equals its content minimum (hundreds of px for
        // a full category); a vertical BoxLayout would overflow the fixed
        // body with it and paint past the footer. Pin the scroll to the
        // actual leftover instead.
        let used = this._rail.get_preferred_height(-1)[1];
        if (this._favSection.visible)
            used += this._favSection.get_preferred_height(-1)[1];
        if (this._recentsPlate.visible)
            used += this._recentsPlate.get_preferred_height(-1)[1];
        used += this._gridSection.get_preferred_height(-1)[1];
        this._gridScroll.height = Math.max(120, this._bodyHeight() - used);

        // grid
        this._gridEntries = searching ? this._emoji.search(query)
            : (this._emoji.categories.find((c) => c.id === this._category)?.emoji || []);

        // Browse mode caches built rows per category: rebuilding ~160 buttons
        // on every category revisit was the visible "too slow" cost.
        // LRU-capped: each cached category holds ~160 button actors.
        const cacheKey = searching ? `q:${query}` : `cat:${this._category}`;
        let rows = this._gridCache.get(cacheKey);
        if (rows) {
            this._gridCache.delete(cacheKey);   // refresh insertion order
            this._gridCache.set(cacheKey, rows);
        } else {
            rows = [];
            let row = null;
            this._gridEntries.forEach((entry, i) => {
                if (i % GRID_COLS === 0) {
                    row = new St.BoxLayout({ style: 'spacing: 0px;' });
                    rows.push(row);
                }
                row.add_child(this._makeCell(entry, { small: false, fixed: false, index: i }));
            });
            // a short last row reads as broken when left-aligned — centre it
            const last = rows[rows.length - 1];
            if (rows.length > 1 && last) {
                const orphan = this._gridEntries.length % GRID_COLS;
                if (orphan > 0) {
                    last.set_style(`padding-left: ${Math.round((GRID_COLS - orphan) * 45 / 2)}px;`);
                }
            }
            this._gridCache.set(cacheKey, rows);
            while (this._gridCache.size > GRID_CACHE_MAX) {
                const [oldestKey, oldRows] = this._gridCache.entries().next().value;
                this._gridCache.delete(oldestKey);
                for (const r of oldRows) {
                    for (const cell of r.get_children()) {
                        if (this._lastSelectedCell === cell) this._lastSelectedCell = null;
                        cell.destroy();
                    }
                    r.destroy();
                }
            }
        }
        this._grid.remove_all_children();
        for (const r of rows) this._grid.add_child(r);
        if (!this._gridEntries.length && searching) {
            const none = new St.Label({
                text: 'No emoji match.',
                style_class: 'cliplet-empty-sub',
                x_align: Clutter.ActorAlign.CENTER,
                style: 'padding-top: 20px;',
            });
            this._grid.add_child(none);
        }

        const cat = this._emoji.categories.find((c) => c.id === this._category);
        if (searching) {
            this._gridSectionLabel.text = 'RESULTS';
            this._gridSectionMeta.text = `${this._gridEntries.length} match${this._gridEntries.length === 1 ? '' : 'es'}`;
            this._keycapHints([
                ['↑↓←→', 'Move'], ['↵', 'Insert'], ['Ctrl+↵', 'Copy'], ['Tab', 'Clipboard'],
            ]);
            this._count.text = `${this._gridEntries.length} result${this._gridEntries.length === 1 ? '' : 's'}`;
        } else {
            this._gridSectionLabel.text = (cat?.label || '').toUpperCase();
            this._gridSectionMeta.text = `all ${this._gridEntries.length} · ←→ to browse`;
            this._keycapHints([
                ['↑↓←→', 'Move'], ['↵', 'Insert'], ['T', 'Skin tone'], ['Tab', 'Clipboard'],
            ]);
            this._count.text = this._settings.get_boolean('emoji-auto-insert')
                ? 'Insert at cursor' : 'Copy on click';
        }

        this._emojiSel = Math.max(0, Math.min(this._gridEntries.length - 1, this._emojiSel));
        this._selectEmoji(this._emojiSel, { scroll: false });
    }

    _makeCell(entry, { small, fixed, index }) {
        // text characters (kaomoji, symbols) render in the text font at a
        // smaller size — the colour-emoji font would box them
        const txt = !!entry.txt;
        const btn = new ClipletCell({
            style_class: `cliplet-grid-cell${small ? ' cliplet-grid-cell-small' : ''}${txt ? ' cliplet-grid-cell-text' : ''}`,
            reactive: true,
        });
        const glyph = this._emoji.glyph(entry);
        btn.child = new St.Label({
            text: glyph,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.accessible_name = entry.n || glyph;
        if (this._emoji.isFavourite(entry)) this._addStar(btn);

        if (!fixed) btn.clipletIndex = index;
        btn.clipletEntry = entry;
        // Click inserts immediately (Windows behaviour): every click pastes
        // its own glyph right away, so repeated clicks are predictable. The
        // old 220 ms deferral made every insert feel dead and merged fast
        // clicks into arbitrary glyph strings.
        btn.connect('clicked', () => {
            this._selectEmoji(btn.clipletIndex, { scroll: false });
            this._activateCell(entry);
        });
        btn._onRightClick = (actor, event) => {
            if (event.get_button() === 3) {
                this._toggleFavourite(entry);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        };
        return btn;
    }

    _addStar(btn) {
        if (btn.clipletStar) return;
        const star = new St.Label({
            text: '★',
            style_class: 'cliplet-star',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
        });
        btn.clipletStar = star;
        btn.get_child().add_child(star);
    }

    _removeStar(btn) {
        if (btn.clipletStar) {
            btn.clipletStar.destroy();
            btn.clipletStar = null;
        }
    }

    _toggleFavourite(entry) {
        const added = this._emoji.toggleFavourite(entry);
        for (const child of this._grid.get_children()) {
            if (child.clipletEntry === entry) {
                if (added) this._addStar(child);
                else this._removeStar(child);
            }
        }
    }

    _selectEmoji(index, { scroll = true } = {}) {
        this._emojiSel = index;
        if (!this._gridEntries[index]) return;
        // O(1) repaint: only the previously selected cell loses its ring.
        const prev = this._lastSelectedCell;
        let next = null;
        for (const row of this._grid.get_children()) {
            for (const cell of row.get_children()) {
                if (cell.clipletIndex === index) {
                    next = cell;
                    break;
                }
            }
            if (next) break;
        }
        if (prev !== next) {
            if (prev) prev.set_style(null);
            if (next) next.set_style(`border: 2px solid ${this._accent};`);
            this._lastSelectedCell = next;
        }
        // live name readout (Windows shows the hovered emoji's name)
        const searching = this._entry.text.trim().length > 0;
        if (!searching) {
            const entry = this._gridEntries[index];
            this._gridSectionMeta.text =
                `${entry.n} · ${index + 1}/${this._gridEntries.length}`;
        }
        if (scroll) {
            const adj = this._gridScroll.vadjustment;
            const rowIndex = Math.floor(index / GRID_COLS);
            const y = rowIndex * 45;
            const visible = adj.page_size;
            if (y < adj.value) adj.value = y;
            else if (y + 45 > adj.value + visible) adj.value = y + 45 - visible;
        }
    }

    _moveEmoji(deltaRow, deltaCol) {
        if (!this._gridEntries.length) return;
        let index = this._emojiSel;
        if (deltaRow) index += deltaRow * GRID_COLS;
        if (deltaCol) index += deltaCol;
        // "←→ to browse": horizontal motion wraps across categories in
        // browse mode (not while searching — that list is flat).
        const searching = this._entry.text.trim().length > 0;
        if (!searching && deltaCol) {
            if (index >= this._gridEntries.length) {
                this._stepCategory(1);
                return;
            }
            if (index < 0) {
                this._stepCategory(-1);
                return;
            }
        }
        index = Math.max(0, Math.min(this._gridEntries.length - 1, index));
        if (index !== this._emojiSel) {
            this._selectEmoji(index);
        }
    }

    _stepCategory(dir) {
        const cats = this._emoji.categories;
        const i = cats.findIndex((c) => c.id === this._category);
        const next = cats[(i + dir + cats.length) % cats.length];
        this._category = next.id;
        this._emojiSel = dir > 0 ? 0 : Math.max(0, next.emoji.length - 1);
        this._refreshEmoji();
    }

    // ---------- actions ----------

    _activateEntry(entry) {
        // click ack: flash the row for one frame-budget beat, then paste —
        // 60ms is below perception threshold but kills the "dead click" feel
        const go = () => this.close(() => this._injector.paste(entry, this._recorded));
        const idx = this._entryRows.findIndex((r) => r.entry === entry);
        const actor = idx >= 0 ? this._entryRows[idx].actor : null;
        if (!actor || !actor.has_style_class_name('cliplet-selected')) {
            go();
            return;
        }
        actor.add_style_class_name('cliplet-flash');
        this._flashActor = actor;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this._clearFlash();
            go();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearFlash() {
        if (!this._flashActor) return;
        try {
            this._flashActor.remove_style_class_name('cliplet-flash');
        } catch {
            // destroyed with a refresh during the flash window — nothing to do
        }
        this._flashActor = null;
    }

    _copyEntry(entry) {
        this._capture.markInternalSet();
        if (entry.kind === 'image' && entry.bytes) {
            St.Clipboard.get_default()
                .set_content(St.ClipboardType.CLIPBOARD, entry.mime, entry.bytes);
        } else {
            St.Clipboard.get_default()
                .set_text(St.ClipboardType.CLIPBOARD, entry.text);
        }
        this.close(() => Main.notify('Cliplet', 'Copied.'));
    }

    _deleteEntry(entry) {
        this._store.delete(entry);
        this._refreshClipboard();
        this._showToast('Deleted — Ctrl+Z to undo');
    }

    _togglePin(entry) {
        const pinned = this._store.togglePin(entry);
        this._refreshClipboard();
        this._showToast(pinned ? 'Pinned' : 'Unpinned');
    }

    _undo() {
        const restored = this._store.undo();
        if (restored) {
            this._refreshClipboard();
            this._showToast('Restored');
        }
    }

    _applyTransform(entry, fn, name) {
        const result = fn(entry.text);
        if (result === entry.text) {
            this._showToast('Nothing to change');
            return;
        }
        this._store.updateText(entry, result);
        this._refreshClipboard();
        this._showToast(`${name} applied — Ctrl+Z to undo`);
    }

    // Decoded + downscaled once per entry, cached — the grid can rebuild
    // often and a full-size decode per frame would defeat the perf budget.
    // Budget is 400px: enough for a full-width preview tile AND sharp enough
    // that the small chip (which scales the same texture down) stays crisp.
    _thumbnailFor(entry) {
        if (entry._thumb) return entry._thumb;
        try {
            // PNG/JPEG bytes decode through a memory stream —
            // Pixbuf.new_from_bytes here is the RAW-pixels variant.
            const stream = Gio.MemoryInputStream.new_from_bytes(entry.bytes);
            const pb = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
            const scale = Math.min(1, 400 / Math.max(pb.get_width(), pb.get_height()));
            const small = scale < 1
                ? pb.scale_simple(Math.round(pb.get_width() * scale),
                    Math.round(pb.get_height() * scale), GdkPixbuf.InterpType.BILINEAR)
                : pb;
            // St.ImageContent.set_data (Shell 50): (cogl_context, data,
            // pixel_format, width, height, row_stride).
            const pixels = small.get_pixels();
            const cogl = Clutter.get_default_backend().get_cogl_context();
            const fmt = small.get_has_alpha()
                ? Cogl.PixelFormat.RGBA_8888
                : Cogl.PixelFormat.RGB_888;
            const content = new St.ImageContent();
            content.set_data(cogl, pixels, fmt,
                small.get_width(), small.get_height(), small.get_rowstride());
            entry._thumb = content;
            entry._thumbSize = [small.get_width(), small.get_height()];
            return content;
        } catch (e) {
            console.warn(`[cliplet] thumbnail decode failed: ${e.message}`);
            return null;
        }
    }

    _revealFiles(entry) {
        const first = entry.text.split('\n').find(Boolean) || '';
        const dir = first.replace(/\/[^/]*$/, '/');
        try {
            Gio.AppInfo.launch_default_for_uri(dir, null);
            this.close();
        } catch {
            this._showToast('No file manager available');
        }
    }

    // Pointer path: insert immediately (see _makeCell).
    _activateCell(entry) {
        this._emoji.bumpUse(entry);
        const glyph = this._emoji.glyph(entry);
        const autoInsert = this._settings.get_boolean('emoji-auto-insert');
        if (autoInsert) {
            this.close(() => this._injector.paste({ text: glyph }, this._recorded));
        } else {
            this._capture.markInternalSet();
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, glyph);
            this.close(() => Main.notify('Cliplet', 'Copied.'));
        }
    }

    _copyCell(entry) {
        this._emoji.bumpUse(entry);
        const glyph = this._emoji.glyph(entry);
        this._capture.markInternalSet();
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, glyph);
        this.close(() => Main.notify('Cliplet', 'Copied.'));
    }

    // ---------- tone popover + overflow menu ----------

    // Persistent 5-dot strip at the end of the rail: one click to switch
    // tone, always visible in emoji mode (unlike the T-key popover).
    _buildToneStrip() {
        this._toneStrip.remove_all_children();
        this._toneChips = [];
        const sample = { cp: '1F44B', t: 1 };
        for (let tone = 0; tone <= 4; tone++) {
            const chip = new St.Button({
                style_class: 'cliplet-tone-chip',
                child: new St.Label({
                    text: this._emoji.glyph(sample, tone),
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                }),
                accessible_name: tone === 0 ? 'Default skin tone' : `Skin tone ${tone}`,
            });
            chip.connect('clicked', () => {
                this._settings.set_int('emoji-tone', tone);
                this._updateToneStrip();
                this._refreshEmoji();
            });
            this._toneStrip.add_child(chip);
            this._toneChips.push(chip);
        }
        this._updateToneStrip();
    }

    _updateToneStrip() {
        if (!this._toneChips) return;
        const current = this._settings.get_int('emoji-tone');
        this._toneChips.forEach((chip, tone) => {
            chip.set_style(tone === current ? `border: 2px solid ${this._accent};` : null);
        });
    }

    _buildTonePop() {
        this._tonePop.remove_all_children();
        const sample = { cp: '1F44B', t: 1 };
        for (let tone = 0; tone <= 4; tone++) {
            const swatch = new St.Button({
                style_class: 'cliplet-tone-swatch',
                child: new St.Label({
                    text: this._emoji.glyph(sample, tone),
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                }),
            });
            if (tone === this._settings.get_int('emoji-tone')) {
                swatch.set_style(`border: 2px solid ${this._accent}; border-radius: 15px;`);
            }
            swatch.connect('clicked', () => {
                this._settings.set_int('emoji-tone', tone);
                this._tonePop.hide();
                this._refreshEmoji();
            });
            this._tonePop.add_child(swatch);
        }
    }

    _toggleTonePop() {
        if (this._tonePop.visible) {
            this._tonePop.hide();
            return;
        }
        this._menu.hide();
        this._buildTonePop();
        this._showPopover(this._tonePop);
    }

    _toggleMenu() {
        if (this._menu.visible) {
            this._menu.hide();
            return;
        }
        const selected = this._entryRows[this._selectedIndex];
        this._openMenu(selected ? selected.entry : null, null);
    }

    // Right-click on a row: select it and pop the item menu anchored above
    // the row (Windows anchors the item context menu at the item).
    _openRowMenu(entry, row) {
        const i = this._entryRows.findIndex((r) => r.actor === row);
        if (i >= 0) this._selectIndex(i, { scroll: false });
        this._openMenu(entry, row);
    }

    _openMenu(entry, anchorRow = null) {
        this._tonePop.hide();
        this._menu.remove_all_children();
        const mkItem = (label, cb, cls = null) => {
            const item = new St.Button({
                style_class: `cliplet-menu-item${cls ? ` ${cls}` : ''}`,
                label,
                x_align: Clutter.ActorAlign.FILL,
            });
            item.connect('clicked', () => {
                this._menu.hide();
                cb();
            });
            this._menu.add_child(item);
            return item;
        };

        const isSnippet = entry !== null && entry.id < 0;
        if (entry) {
            if (!isSnippet) {
                mkItem(entry.pinned ? 'Unpin' : 'Pin', () => this._togglePin(entry));
            }
            mkItem('Copy', () => this._copyEntry(entry));
            if (!isSnippet && entry.kind === 'files') {
                mkItem('Reveal in Files', () => this._revealFiles(entry));
            }
            if (!isSnippet && !entry.masked && entry.kind !== 'image') {
                const header = new St.Label({
                    text: 'TRANSFORM',
                    style_class: 'cliplet-menu-header',
                    x_align: Clutter.ActorAlign.FILL,
                });
                this._menu.add_child(header);
                for (const [name, fn] of Object.entries(TRANSFORMS)) {
                    mkItem(name, () => this._applyTransform(entry, fn, name));
                }
                if (this._snippets) {
                    mkItem('Save as snippet', () => {
                        const text = entry.text;
                        const name = text.split('\n')[0].trim().slice(0, 40) || 'snippet';
                        this._snippets.set(name, text);
                        this._showToast(`Saved snippet "${name}" — edit in Preferences`);
                    });
                }
            }
            if (!isSnippet) {
                mkItem('Delete', () => this._deleteEntry(entry), 'cliplet-danger');
            }
        }

        if (!anchorRow) {
            // overflow menu: global commands around the selected item
            const paused = this._settings.get_boolean('pause-capture');
            mkItem(paused ? 'Resume capture' : 'Pause capture (private mode)', () => {
                this._settings.set_boolean('pause-capture', !paused);
            });
            if (this._settings.get_boolean('enable-ocr')) {
                mkItem('Capture text from screen (OCR)', () => {
                    this.close();
                    this._onOcr();
                });
            }
            if (this._multicopy && this._mode === 'clipboard') {
                if (this._multicopy.collecting) {
                    const n = this._multicopy.queue.length;
                    mkItem(`Paste all & stop collecting (${n})`, () => this._multicopyPasteAll());
                    mkItem('Stop collecting (keep in history)', () => this._multicopyStop());
                } else {
                    mkItem('Start collecting (MultiCopy)', () => {
                        this._multicopy.collecting = true;
                        this._multicopy.queue = [];
                        this._showToast('Collecting — copies join the queue instead of history');
                    });
                }
            }
            if (this._mode === 'clipboard') {
                if (this._store.hasUndo()) {
                    mkItem('Undo', () => this._undo());
                }
                mkItem('Clear history', () => {
                    this._store.clearHistory();
                    this._refreshClipboard();
                    this._showToast('History cleared — Ctrl+Z to undo');
                });
            }
            mkItem('Skin tone…', () => this._toggleTonePop());
        }

        // anchor: above the invoking row, else bottom-right corner (overflow)
        if (anchorRow) {
            const [sx, sy] = anchorRow.get_transformed_position();
            const [, wy] = this._stack.get_transformed_position();
            const stackH = this._stack.get_allocation_box().get_height();
            const rowTop = sy - wy;
            const mb = Math.max(8, Math.min(stackH - rowTop + 8, stackH - 300));
            this._menu.set_style(`margin-right: 10px; margin-bottom: ${Math.round(mb)}px;`);
        } else {
            this._menu.set_style('margin-right: 10px; margin-bottom: 52px;');
        }
        this._showPopover(this._menu);
    }

    // Ctrl+click / Ctrl+D: rows join the existing MultiCopy queue, then
    // "Paste all & stop collecting" in the ⋮ menu pastes them joined.
    _toggleCollect(entry) {
        const mc = this._multicopy;
        if (!mc) return;
        if (!mc.collecting) {
            mc.collecting = true;
            mc.queue = [];
        }
        const i = mc.queue.findIndex((q) => q._id === entry.id);
        if (i >= 0) mc.queue.splice(i, 1);
        else mc.queue.push({ ...entry, _id: entry.id });
        this._refreshClipboard();
        this._showToast(i >= 0
            ? `Removed from collection (${mc.queue.length} left)`
            : `Added to collection (${mc.queue.length}) — paste all from the ⋮ menu`);
    }

    // MultiCopy: paste the queue as one joined text, then merge the queued
    // clips into history so nothing is lost either way.
    _multicopyPasteAll() {
        const mc = this._multicopy;
        const joined = mc.queue.map((q) => q.text).join('\n');
        mc.collecting = false;
        this._multicopyMerge();
        if (joined) {
            this.close(() => this._injector.paste({ text: joined }, this._recorded));
        }
    }

    _multicopyStop() {
        this._multicopy.collecting = false;
        this._multicopyMerge();
        this._showToast('Collected clips moved to history');
    }

    _multicopyMerge() {
        const mc = this._multicopy;
        for (const q of mc.queue) {
            this._store.add({ ...q });
        }
        mc.queue = [];
        this._refreshClipboard();
    }

    _showToast(message) {
        this._toast.text = message;
        this._toast.show();
        if (this._toastId) GLib.source_remove(this._toastId);
        this._toastId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOAST_MS, () => {
            this._toastId = 0;
            this._toast.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---------- input ----------

    // Target-phase events on the root (implicit pointer grab after a
    // consumed chrome press). Belt-and-suspenders next to the drag filter —
    // only an active drag uses this path.
    _onDirectEvent(event) {
        if (!this._drag) return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            this._dragMove(event);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._dragEnd();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // Pre-delivery drag continuation (see the chrome-drag press handler).
    _onDragFilter(event) {
        if (!this._drag) {
            this._stopDragFilter();
            return Clutter.EVENT_PROPAGATE;
        }
        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            this._dragMove(event);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._dragEnd();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _stopDragFilter() {
        if (this._dragFilterId) {
            Clutter.Event.remove_filter(this._dragFilterId);
            this._dragFilterId = 0;
        }
    }

    _dragMove(event) {
        const [x, y] = event.get_coords();
        const rootW = this._root.get_allocation_box().get_width();
        const rootH = this._root.get_allocation_box().get_height();
        const panelH = this._compact ? COMPACT_H : PANEL_H;
        const nx = Math.max(8, Math.min(rootW - PANEL_W - 8,
            this._drag.ox + (x - this._drag.sx)));
        const ny = Math.max(8, Math.min(rootH - panelH - 8,
            this._drag.oy + (y - this._drag.sy)));
        this._panel.set_position(nx, ny);
    }

    _dragEnd(_event) {
        this._stopDragFilter();
        // panel coords are root-relative already — persist as remembered
        this._settings.set_int('popup-x', Math.round(this._panel.x));
        this._settings.set_int('popup-y', Math.round(this._panel.y));
        this._drag = null;
    }

    _onCaptured(event) {
        const type = event.type();

        if (type === Clutter.EventType.KEY_PRESS) {
            this._trackMods(event, true);
            if (!this._isOpen) return Clutter.EVENT_STOP;   // exit-fade window
            const consumed = this._onKeyPress(event);
            return consumed ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.KEY_RELEASE) {
            this._trackMods(event, false);
            if (!this._isOpen && this._closeAfter && this._heldMods.size === 0) {
                this._maybeFinishClose();
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.BUTTON_PRESS) {
            const [x, y] = event.get_coords();
            const alloc = this._panel.get_allocation_box();
            const [px, py] = this._panel.get_transformed_position();
            const inside = x >= px && x <= px + alloc.get_width() && y >= py && y <= py + alloc.get_height();
            if (!inside) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (this._tonePop.visible || this._menu.visible) {
                this._tonePop.hide();
                this._menu.hide();
            }
            // Windows-style drag: grab the header or footer chrome (not the
            // search entry, segments, or buttons) and move the panel.
            if (!this._interactiveAt(x, y)) {
                const localY = y - py;
                const chrome = (localY >= 0 && localY <= HEADER_H) ||
                    (localY >= alloc.get_height() - FOOTER_H && localY <= alloc.get_height());
                if (chrome) {
                    const [rx] = this._root.get_transformed_position();
                    this._drag = { sx: x, sy: y, ox: px - rx, oy: py - this._root.get_transformed_position()[1], rx };
                    // Consuming the press implicit-grabs the pointer away from
                    // the normal capture path — subsequent motion/release
                    // events do NOT reach vfunc_captured_event. A pre-delivery
                    // event filter sees every event regardless of grabs, so
                    // the drag continues there until the button comes up.
                    this._dragFilterId = Clutter.Event.add_filter(null, (ev) => this._onDragFilter(ev));
                    return Clutter.EVENT_STOP;
                }
            }
        }
        if (type === Clutter.EventType.MOTION && this._drag) {
            this._dragMove(event);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE && this._drag) {
            this._dragEnd(event);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // The event's source actor. Under a Shell 50 stage grab, BUTTON_PRESS /
    // BUTTON_RELEASE arrive with get_source() === null (the event targets the
    // grab actor, not the picked child) — resolve the real target by picking.
    // Without this, _isInteractive(null) misread every press as chrome-drag
    // and the segment tabs could never receive a click.
    _eventSource(event, x, y) {
        const src = event.get_source();
        if (src) return src;
        try {
            return global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        } catch {
            return null;
        }
    }

    // Interactive widgets the drag must never steal presses from, decided in
    // PANEL-LOCAL coordinates: composed parent-relative boxes are stable,
    // while transformed reads can momentarily lag the panel's position (the
    // entry's ClutterText once resolved whole header-band presses to "the
    // entry", silently killing the drag zone).
    _panelLocalBox(actor) {
        let box = null;
        let a = actor;
        while (a && a !== this._panel) {
            const ab = a.get_allocation_box();
            if (!box) box = { x1: ab.x1, y1: ab.y1, w: ab.get_width(), h: ab.get_height() };
            else { box.x1 += ab.x1; box.y1 += ab.y1; }
            a = a.get_parent();
        }
        return (a === this._panel) ? box : null;   // not a panel descendant
    }

    _interactiveAt(x, y) {
        const [px, py] = this._panel.get_transformed_position();
        const lx = x - px;
        const ly = y - py;
        for (const actor of [this._entry, this._segment, this._overflowBtn, this._tonePop, this._menu]) {
            if (!actor?.visible) continue;
            const b = this._panelLocalBox(actor);
            if (b && lx >= b.x1 && lx <= b.x1 + b.w && ly >= b.y1 && ly <= b.y1 + b.h) return true;
        }
        return false;
    }

    _trackMods(event, down) {
        const MOD_KEYS = new Set([
            Clutter.KEY_Shift_L, Clutter.KEY_Shift_R,
            Clutter.KEY_Control_L, Clutter.KEY_Control_R,
            Clutter.KEY_Alt_L, Clutter.KEY_Alt_R,
            Clutter.KEY_Super_L, Clutter.KEY_Super_R,
            Clutter.KEY_Meta_L, Clutter.KEY_Meta_R,
        ]);
        const keyval = event.get_key_symbol();
        if (MOD_KEYS.has(keyval)) {
            if (down) this._heldMods.add(keyval);
            else this._heldMods.delete(keyval);
        }
    }

    _onKeyPress(event) {
        const keyval = event.get_key_symbol();
        const mods = event.get_state() & Clutter.ModifierType.MODIFIER_MASK;
        const ctrl = (mods & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const alt = (mods & Clutter.ModifierType.MOD1_MASK) !== 0;
        const entryEmpty = this._entry.text.length === 0;

        switch (keyval) {
            case Clutter.KEY_Escape:
                if (this._tonePop.visible || this._menu.visible) {
                    this._tonePop.hide();
                    this._menu.hide();
                    return true;
                }
                this.close();
                return true;

            case Clutter.KEY_Tab:
                this._setMode(this._mode === 'clipboard' ? 'emoji' : 'clipboard');
                return true;

            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
                if (this._mode === 'clipboard') {
                    const row = this._entryRows[this._selectedIndex];
                    if (row) {
                        if (ctrl) this._copyEntry(row.entry);
                        else this._activateEntry(row.entry);
                    } else {
                        this.close();
                    }
                } else {
                    const entry = this._gridEntries[this._emojiSel];
                    if (entry) {
                        if (ctrl) this._copyCell(entry);
                        else this._activateCell(entry);
                    }
                }
                return true;

            case Clutter.KEY_z:
            case Clutter.KEY_Z:
                if (ctrl && this._mode === 'clipboard') {
                    this._undo();
                    return true;
                }
                return false;

            case Clutter.KEY_p:
            case Clutter.KEY_P:
                if (ctrl && this._mode === 'clipboard') {
                    const row = this._entryRows[this._selectedIndex];
                    if (row) this._togglePin(row.entry);
                    return true;
                }
                return false;

            case Clutter.KEY_d:
            case Clutter.KEY_D:
                if (ctrl && this._mode === 'clipboard') {
                    const row = this._entryRows[this._selectedIndex];
                    if (row && row.entry.id > 0) this._toggleCollect(row.entry);
                    return true;
                }
                return false;

            case Clutter.KEY_t:
            case Clutter.KEY_T:
                if (ctrl && this._mode === 'emoji') {
                    this._toggleTonePop();
                    return true;
                }
                return false;

            case Clutter.KEY_f:
            case Clutter.KEY_F:
                if (ctrl && this._mode === 'emoji') {
                    const entry = this._gridEntries[this._emojiSel];
                    if (entry) this._toggleFavourite(entry);
                    return true;
                }
                return false;

            case Clutter.KEY_Delete:
                if (this._mode === 'clipboard' && (entryEmpty || ctrl)) {
                    const row = this._entryRows[this._selectedIndex];
                    if (row) this._deleteEntry(row.entry);
                    return true;
                }
                return false;

            case Clutter.KEY_BackSpace:
                if (this._mode === 'clipboard' && entryEmpty && !ctrl) {
                    const row = this._entryRows[this._selectedIndex];
                    if (row) this._deleteEntry(row.entry);
                    return true;
                }
                return false;
        }

        if (this._mode === 'clipboard') {
            switch (keyval) {
                case Clutter.KEY_Up: this._moveSelection(-1); return true;
                case Clutter.KEY_Down: this._moveSelection(1); return true;
                case Clutter.KEY_Page_Up: this._moveSelection(-8); return true;
                case Clutter.KEY_Page_Down: this._moveSelection(8); return true;
                case Clutter.KEY_Home: if (entryEmpty) { this._selectIndex(0); return true; } return false;
                case Clutter.KEY_End: if (entryEmpty) { this._selectIndex(this._entryRows.length - 1); return true; } return false;
            }
            // 1–9 quick-pick (DR-25): keyboard-open only, search empty.
            if (this._openSource === 'keyboard' && entryEmpty && !ctrl && !alt) {
                const n = this._digitOf(keyval);
                if (n > 0 && this._entryRows[n - 1]) {
                    this._selectIndex(n - 1, { scroll: false });
                    this._activateEntry(this._entryRows[n - 1].entry);
                    return true;
                }
            }
        } else {
            switch (keyval) {
                case Clutter.KEY_Up: this._moveEmoji(-1, 0); return true;
                case Clutter.KEY_Down: this._moveEmoji(1, 0); return true;
                case Clutter.KEY_Left: this._moveEmoji(0, -1); return true;
                case Clutter.KEY_Right: this._moveEmoji(0, 1); return true;
            }
        }
        return false;
    }

    _digitOf(keyval) {
        const map = {
            [Clutter.KEY_1]: 1, [Clutter.KEY_2]: 2, [Clutter.KEY_3]: 3,
            [Clutter.KEY_4]: 4, [Clutter.KEY_5]: 5, [Clutter.KEY_6]: 6,
            [Clutter.KEY_7]: 7, [Clutter.KEY_8]: 8, [Clutter.KEY_9]: 9,
        };
        return map[keyval] || 0;
    }
}
