"""Compose all Cliplet preview SVGs."""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import doc, rect, txt, circle, save, Tokens, _dedupe_defs
import bg
from render_clip import popup_A, popup_B, popup_C, icon
from render_emoji import picker_A, settings

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "svg")
os.makedirs(SVG, exist_ok=True)


def glass_defs():
    return '''
    <linearGradient id="glassdark" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="#2a2b30" stop-opacity="0.82"/>
      <stop offset="55%" stop-color="#212227" stop-opacity="0.80"/>
      <stop offset="100%" stop-color="#1b1c20" stop-opacity="0.86"/>
    </linearGradient>
    <linearGradient id="glasslight" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#f4f5f7" stop-opacity="0.86"/>
    </linearGradient>
    <linearGradient id="thumbA" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3f6fb5"/>
      <stop offset="55%" stop-color="#7a4fb0"/>
      <stop offset="100%" stop-color="#e07a4f"/>
    </linearGradient>
    '''


_DEF_RE = re.compile(r'<defs>(.*?)</defs>', re.S)


def _extract(svg):
    """Split a document or fragment into (definitions, body).

    Handles both shapes this codebase produces: a full document from doc(), and
    a bare fragment from bg.desktop() that carries its own <defs>. Definitions
    are hoisted so the composed file has exactly one copy of each id.
    """
    defs = "".join(_DEF_RE.findall(svg))
    body = _DEF_RE.sub("", svg)
    m = re.search(r'<svg[^>]*>(.*)</svg>', body, re.S)
    if m:
        body = m.group(1)
    return defs, body


def place(page_w, page_h, theme, scene_body, px, py, popup_svg, r=14):
    pw, ph = _w(popup_svg), _h(popup_svg)      # measure before stripping the root
    sdefs, sbody = _extract(scene_body)
    pdefs, pbody = _extract(popup_svg)
    body = [sbody]
    body.append(f'<rect x="{px+2}" y="{py+20}" width="{pw-4}" height="{ph}" rx="{r}" fill="rgba(0,0,0,0.52)" filter="url(#soft)"/>')
    body.append(f'<rect x="{px}" y="{py+10}" width="{pw}" height="{ph}" rx="{r}" fill="rgba(0,0,0,0.22)" filter="url(#soft)"/>')
    body.append(f'<g transform="translate({px},{py})">{pbody}</g>')
    # doc() already emits soft / soft2 / blurBg; anything the scene or popup
    # brings with the same id is a duplicate and gets dropped here.
    defs = glass_defs() + _dedupe_defs(sdefs + pdefs, reserved=("soft", "soft2", "blurBg"))
    return doc(page_w, page_h, "".join(body), defs)


def strip_body(svg):
    """Body only — every definition stripped (the host document supplies them)."""
    return _extract(svg)[1]


def architecture_figure():
    from lib import rect as R, txt as T, path as P
    W, H = 1400, 700
    o = [R(0, 0, W, H, "#131315")]
    o.append(T(40, 56, "Recommended architecture — extension-only, with a daemon seam", 21, "#ffffff", 700))
    o.append(T(40, 82, "Everything inside the blue region runs in the GNOME Shell process. Everything to the right of it does not.", 12, "rgba(255,255,255,0.55)", 400))

    # shell boundary
    o.append(R(40, 104, 850, 452, "rgba(53,132,228,0.05)", 12, "rgba(53,132,228,0.45)", 1.5))
    o.append(T(60, 130, "GNOME SHELL (GJS, ESM)", 10, "#7fb2f0", 700, spacing="1.2"))

    def box(x, y, w, h, title, sub, accent="rgba(255,255,255,0.07)", border="rgba(255,255,255,0.14)"):
        out = [R(x, y, w, h, accent, 8, border, 1)]
        out.append(T(x + 14, y + 24, title, 13, "#ffffff", 600))
        for i, line in enumerate(sub):
            out.append(T(x + 14, y + 44 + i * 15, line, 10.5, "rgba(255,255,255,0.55)", 400, mono=True))
        return "".join(out)

    o.append(box(64, 148, 250, 92, "capture.js", [
        "owner-changed → debounce(80–120ms)",
        "get_mimetypes()  ← hint check FIRST",
        "defer read · size gate · coalesce"]))
    o.append(box(64, 256, 250, 78, "images.js", [
        "byte gate → GdkPixbuf worker",
        "128 px thumb · St.ImageContent"]))
    o.append(box(64, 350, 250, 78, "search.js", [
        "token index, built off the capture",
        "path · debounced 30–50 ms"]))
    o.append(box(64, 444, 250, 88, "store.js", [
        "Store interface:",
        "MemoryStore · FileStore(opt-in)",
        "…DbusStore (future)"]))
    o.append(box(346, 148, 250, 92, "PopupShell", [
        "one actor · one grab",
        "first row pre-selected",
        "Esc restores focus"]))
    o.append(box(346, 256, 250, 78, "PasteService", [
        "focus-target guard (DR-09)",
        "terminal branch · virtual device"]))
    o.append(box(346, 350, 250, 78, "Keybindings", [
        "grab_accelerator +",
        "allowKeybinding · conflict check"]))
    o.append(box(346, 444, 250, 88, "Theme", [
        "tokens → St.Theme",
        "prefers-color-scheme · accent",
        "reduced-motion"]))
    o.append(box(628, 148, 240, 92, "EmojiModule", [
        "isolated: no clipboard API",
        "CLDR data at build time"]))
    o.append(box(628, 256, 240, 78, "ClipboardModule", [
        "entirely absent when disabled",
        "(V10 proof test)"]))
    o.append(box(628, 350, 240, 168, "extension.js", [
        "enable():",
        "  connect · grab · build actors",
        "disable():",
        "  disconnect · ungrab · destroy",
        "  clear Maps · cancel tasks",
        "",
        "no module-scope GObjects (S9)"]))

    # arrows
    def arrow(x1, y1, x2, y2):
        return P(f"M{x1} {y1} L{x2} {y2}", stroke="rgba(255,255,255,0.30)", sw=1.3)
    o.append(arrow(314, 194, 346, 194))
    o.append(arrow(314, 295, 346, 295))
    o.append(arrow(471, 240, 471, 256))
    o.append(arrow(748, 240, 748, 256))

    # outside shell
    o.append(box(930, 148, 270, 92, "prefs.js", [
        "GTK4 + libadwaita (separate process)",
        "6 pages · GSettings"], "rgba(255,255,255,0.05)"))
    o.append(box(930, 256, 270, 92, "GSettings", [
        "org.gnome.shell.extensions.cliplet",
        "constructed in enable(), not at scope"]))
    o.append(box(930, 364, 270, 92, "cliplet-daemon", [
        "NOT IN V1",
        "SQLite WAL + FTS5 when a measured",
        "threshold is crossed"], "rgba(255,255,255,0.035)"))
    for i, ln in enumerate(["Daemon seam = a documented D-Bus", "shape and a Store interface,", "not an installed process."]):
        o.append(T(930, 486 + i * 16, ln, 10.5, "rgba(255,255,255,0.42)", 400))

    # security emphasis box
    o.append(R(40, 656, 1320, 44, "rgba(53,132,228,0.10)", 8, "rgba(53,132,228,0.35)", 1))
    o.append(T(60, 683, "The only synchronous work on the shell main thread is Meta.Selection.get_mimetypes(). Everything else is deferred, off-thread, or bounded by a byte gate.", 12, "rgba(255,255,255,0.86)", 500))
    save(doc(W, H, "".join(o)), os.path.join(SVG, "18-architecture.svg"))


def unified_figures():
    """Unified two-mode popup, plus the user-chosen shortcut flow and settings options."""
    import render_unified as U


    td = Tokens("A", "dark")
    tl = Tokens("A", "light")

    cl = U.popup_clip(td, "default")
    save(wrap(cl, 640, _h(cl)), os.path.join(SVG, "19-unified-clipboard-dark.svg"))
    em = U.popup_emoji(td)
    save(wrap(em, 640, _h(em)), os.path.join(SVG, "20-unified-emoji-dark.svg"))
    ems = U.popup_emoji(td, "search")
    save(wrap(ems, 640, _h(ems)), os.path.join(SVG, "21-unified-emoji-search.svg"))
    cll = U.popup_clip(tl, "default")
    save(wrap(cll, 640, _h(cll), "light"), os.path.join(SVG, "22-unified-clipboard-light.svg"))

    # desktop composite with the unified popup in emoji mode
    desk = bg.desktop("dark")
    save(place(1920, 1200, "dark", desk, 700, 236, U.popup_emoji(td)), os.path.join(SVG, "23-desktop-unified.svg"))

    # ---- shortcut flow: assignable, disableable ----
    sw, sh = 1160, 648
    s = [rect(0, 0, sw, sh, "#131315")]
    s.append(txt(40, 56, "Shortcuts are the user’s decision — assign, rebind, or switch off", 21, "#ffffff", 700))
    s.append(txt(40, 82, "Three rows per module: the accelerator, who owns it, and an off switch. Nothing is forced and nothing is silently stolen.", 12.5, "rgba(255,255,255,0.55)", 400))

    # panel
    px, py, pw = 40, 106, 640
    s.append(rect(px, py, pw, 372, "#28282b", 12, "rgba(255,255,255,0.09)", 1))
    s.append(txt(px + 20, py + 34, "Clipboard history", 15, "#ffffff", 700))
    rows = [
        ("Open popup", "Super + V", "Windows-style preset · replaces GNOME’s notification list binding", "chip"),
        ("Open popup (alternate)", "Super + Shift + V", "No known conflict", "chip"),
        ("Module", "Enabled", "Turn off to remove every clipboard connection", "toggle"),
    ]
    yy = py + 58
    for i, (label, key, note, kind) in enumerate(rows):
        s.append(rect(px + 20, yy, pw - 40, 1, "rgba(255,255,255,0.07)"))
        s.append(txt(px + 22, yy + 26, label, 12.5, "rgba(255,255,255,0.90)", 500))
        s.append(txt(px + 22, yy + 45, note, 10.5, "rgba(255,255,255,0.48)", 400))
        if kind == "chip":
            cw = 26 + len(key) * 7.6
            s.append(rect(px + pw - 40 - cw, yy + 14, cw, 30, "rgba(255,255,255,0.09)", 7, "rgba(255,255,255,0.18)", 1))
            s.append(txt(px + pw - 40 - cw / 2, yy + 34, key, 11.5, "#ffffff", 600, anchor="middle"))
            s.append(icon(px + pw - 40 - cw - 24, yy + 20, 14, "chevron", "rgba(255,255,255,0.4)"))
        else:
            s.append(rect(px + pw - 40 - 46, yy + 14, 46, 26, "#3584e4", 13))
            s.append(circle(px + pw - 40 - 13, yy + 27, 11, "#ffffff"))
        yy += 62

    # conflict state
    cy = py + 250
    s.append(rect(px + 20, cy, pw - 40, 96, "rgba(245,194,17,0.07)", 8, "rgba(245,194,17,0.32)", 1))
    s.append(txt(px + 36, cy + 26, "⚠  Super + V is already used by GNOME", 12.5, "#f5c211", 600))
    s.append(txt(px + 36, cy + 46, "“Show the notification list” is bound in org.gnome.shell.keybindings.", 11, "rgba(255,255,255,0.62)", 400))
    s.append(txt(px + 36, cy + 64, "Cliplet will take it over. Undo here, or reset it in GNOME Settings › Keyboard.", 11, "rgba(255,255,255,0.62)", 400))
    s.append(rect(px + 36, cy + 74, 104, 0, "none", 0))
    s.append(rect(px + 36, cy + 72, 104, 20, "rgba(255,255,255,0.10)", 5, "rgba(255,255,255,0.2)", 1))
    s.append(txt(px + 88, cy + 86, "Use anyway", 10, "#ffffff", 600, anchor="middle"))
    s.append(rect(px + 152, cy + 72, 104, 20, "rgba(255,255,255,0.05)", 5, "rgba(255,255,255,0.14)", 1))
    s.append(txt(px + 204, cy + 86, "Keep Super+Shift+V", 10, "rgba(255,255,255,0.72)", 600, anchor="middle"))

    # right column: the three modes
    rx = 720
    s.append(txt(rx, py + 8, "Three ways to open the same popup", 13.5, "#ffffff", 700))
    modes = [
        ("Shortcut, chosen by the user", "Assign clipboard and emoji accelerators independently. Either can be disabled. Diagnostics at enable() warn about ownership before the key is taken.", "1"),
        ("One popup, switched inside it", "A segmented control in the header moves between Clipboard and Emoji. Tab flips modes; the popup remembers where you were.", "2"),
        ("Pointer or panel", "Optional top-bar entry and a click on the caret for people who do not want to learn a chord at all.", "3"),
    ]
    my = py + 34
    for title, body_, n in modes:
        s.append(rect(rx, my, 400, 104, "rgba(255,255,255,0.045)", 10, "rgba(255,255,255,0.10)", 1))
        s.append(rect(rx + 16, my + 18, 22, 22, "rgba(53,132,228,0.28)", 6))
        s.append(txt(rx + 27, my + 34, n, 11.5, "#ffffff", 700, anchor="middle"))
        s.append(txt(rx + 50, my + 33, title, 12.5, "#ffffff", 600))
        words = body_.split()
        line, lines = "", []
        for wd in words:
            if len(line + " " + wd) > 56:
                lines.append(line); line = wd
            else:
                line = (line + " " + wd).strip()
        lines.append(line)
        for i, ln in enumerate(lines[:3]):
            s.append(txt(rx + 50, my + 54 + i * 15, ln, 10.5, "rgba(255,255,255,0.58)", 400))
        my += 116

    # behavior note
    s.append(rect(40, 508, 1080, 96, "rgba(53,132,228,0.09)", 10, "rgba(53,132,228,0.32)", 1))
    s.append(txt(60, 536, "Emoji click inserts at the cursor", 13, "#ffffff", 700))
    s.append(txt(60, 558, "The chosen emoji is injected into the focused text field, then the popup closes. If insertion is refused or the", 11, "rgba(255,255,255,0.68)", 400))
    s.append(txt(60, 574, "focus target changed, the glyph is copied instead — Cliplet never types into a window you did not choose.", 11, "rgba(255,255,255,0.68)", 400))
    s.append(txt(60, 592, "Clipboard rows still paste on Enter. Ctrl+Enter copies without pasting.", 11, "rgba(255,255,255,0.46)", 400))
    save(doc(sw, sh, "".join(s), glass_defs()), os.path.join(SVG, "24-shortcut-and-mode-flow.svg"))

    # ---- settings: Shortcuts + Emoji pages ----
    def settings_two():
        W2, H2 = 1180, 700
        o = [rect(0, 0, W2, H2, "#131315")]

        def window(x0, y0, w, h, title, groups, active, sub="Set per module. Nothing is forced."):
            g = [rect(x0, y0 + 14, w, h, "rgba(0,0,0,0.5)", 14)]
            g.append(rect(x0, y0, w, h, "#1e1e20", 12))
            g.append(f'<path d="M{x0} {y0+12} a12 12 0 0 1 12 -12 h{w-24} a12 12 0 0 1 12 12 v40 h-{w} z" fill="#2b2b2e"/>')
            g.append(txt(x0 + w / 2, y0 + 30, "Cliplet", 13.5, "#ffffff", 700, anchor="middle"))
            g.append(rect(x0, y0 + 51, w, 1, "rgba(255,255,255,0.08)"))
            g.append(rect(x0, y0 + 52, 196, h - 52, "#232326"))
            g.append(rect(x0 + 196, y0 + 52, 1, h - 52, "rgba(255,255,255,0.07)"))
            for i, nm in enumerate(["Clipboard", "Emoji", "Shortcuts", "Storage", "Privacy", "About"]):
                yy = y0 + 80 + i * 38
                act = (nm == active)
                if act:
                    g.append(rect(x0 + 8, yy - 16, 180, 32, "rgba(255,255,255,0.09)", 6))
                g.append(txt(x0 + 24, yy + 5, nm, 12.5, "#ffffff" if act else "rgba(255,255,255,0.58)", 600 if act else 400))

            cx0 = x0 + 216
            cw = w - 240
            right = cx0 + cw - 16
            cy = y0 + 88
            g.append(txt(cx0, cy, title, 18, "#ffffff", 700))
            cy += 14
            g.append(txt(cx0, cy + 10, sub, 11, "rgba(255,255,255,0.45)", 400))
            cy += 32

            for hdr, items in groups:
                if hdr:
                    g.append(txt(cx0, cy + 8, hdr.upper(), 9.5, "rgba(255,255,255,0.42)", 700, spacing="1.1"))
                    cy += 22
                gh = 6 + len(items) * 58 + 6
                g.append(rect(cx0, cy, cw, gh, "#28282b", 10, "rgba(255,255,255,0.08)", 1))
                for i, (t1, t2, ctl) in enumerate(items):
                    ry = cy + 6 + i * 58
                    if i:
                        g.append(rect(cx0 + 16, ry, cw - 32, 1, "rgba(255,255,255,0.07)"))
                    g.append(txt(cx0 + 16, ry + 22, t1, 12.5, "#ffffff", 500))
                    g.append(txt(cx0 + 16, ry + 40, t2, 10.5, "rgba(255,255,255,0.52)", 400))
                    if ctl in ("on", "off"):
                        sx = right - 44
                        g.append(rect(sx, ry + 18, 44, 24, "#3584e4" if ctl == "on" else "rgba(255,255,255,0.16)", 12))
                        g.append(circle(sx + (30 if ctl == "on" else 14), ry + 30, 10, "#ffffff"))
                    elif ctl:
                        cwid = 18 + len(ctl) * 7.0
                        g.append(rect(right - cwid, ry + 15, cwid, 26, "rgba(255,255,255,0.09)", 6,
                                      "rgba(255,255,255,0.18)", 1))
                        g.append(txt(right - cwid / 2, ry + 32, ctl, 10.5, "#ffffff", 600, anchor="middle"))
                cy += gh + 20
            return "".join(g)

        w1 = window(30, 40, 520, 620, "Shortcuts", [
            ("KEYBOARD", [
                ("Clipboard popup", "Super + V", "Super + V"),
                ("Emoji picker", "Super + .", "Super + ."),
                ("Switch mode", "Tab inside the popup", "Tab"),
            ]),
            ("MODULES", [
                ("Clipboard module", "Off removes all clipboard access", "on"),
                ("Emoji module", "Independent of clipboard history", "on"),
            ]),
        ], active="Shortcuts")
        w2 = window(620, 40, 530, 620, "Emoji", [
            ("BEHAVIOUR", [
                ("Insert on click", "Puts the emoji at the cursor, then closes", "on"),
                ("Copy instead of insert", "Only if an app refuses synthetic input", "off"),
                ("Recent band", "Shown above the grid", "on"),
            ]),
            ("APPEARANCE", [
                ("Default skin tone", "Five tones", "Medium"),
                ("Grid density", "10 columns at 640 px", "Comfort"),
            ]),
        ], active="Emoji", sub="Insertion, recents and appearance.")
        o.append(w1)
        o.append(w2)
        return doc(W2, H2, "".join(o), glass_defs())

    save(settings_two(), os.path.join(SVG, "25-settings-shortcuts-emoji.svg"))
    print("unified figures written")


def _h(svg):
    m = re.search(r'width="(\d+)" height="(\d+)"', svg)
    return int(m.group(2))


def _w(svg):
    m = re.search(r'width="(\d+)" height="(\d+)"', svg)
    return int(m.group(1))


def wrap(svg, w, h, theme="dark", pad=56):
    W, H = w + pad * 2, h + pad * 2
    bgc = "#131315" if theme == "dark" else "#eceaea"
    b = [rect(0, 0, W, H, bgc)]
    sh1 = "rgba(0,0,0,0.40)" if theme == "dark" else "rgba(0,0,0,0.13)"
    sh2 = "rgba(0,0,0,0.22)" if theme == "dark" else "rgba(0,0,0,0.07)"
    b.append(f'<rect x="{pad+4}" y="{pad + 12}" width="{w-8}" height="{h-4}" rx="16" fill="{sh1}" filter="url(#soft)"/>')
    b.append(f'<rect x="{pad+12}" y="{pad + 18}" width="{w-24}" height="{h-10}" rx="16" fill="{sh2}" filter="url(#soft)"/>')
    pdefs, pbody = _extract(svg)          # hoist the popup's own FADE_DEFS
    b.append(f'<g transform="translate({pad},{pad})">{pbody}</g>')
    pdefs = _dedupe_defs(pdefs, reserved=("soft", "soft2", "blurBg"))
    return doc(W, H, "".join(b), glass_defs() + pdefs)

def main():
    # --- flat popups: strip their own doc wrapper ---
    def body_of(svg):
        return strip_body(svg)



    save(wrap(popup_A("dark", "default"), 640, 596), os.path.join(SVG, "01-clipboard-default-dark.svg"))
    save(wrap(popup_A("dark", "pinned"), 640, 596), os.path.join(SVG, "02-clipboard-pinned-dark.svg"))
    save(wrap(popup_A("dark", "search"), 640, 596), os.path.join(SVG, "03-clipboard-search-dark.svg"))
    save(wrap(popup_A("dark", "hover"), 640, 596, pad=48), os.path.join(SVG, "04-clipboard-hover-actions.svg"))
    save(wrap(popup_A("dark", "image"), 640, 596), os.path.join(SVG, "05-clipboard-image-preview.svg"))
    save(wrap(popup_A("light", "empty"), 640, 596, "light"), os.path.join(SVG, "06-clipboard-empty-light.svg"))
    save(wrap(popup_A("light", "default"), 640, 596, "light"), os.path.join(SVG, "07-clipboard-default-light.svg"))

    save(wrap(picker_A("dark", "default"), 480, _h(picker_A("dark", "default"))), os.path.join(SVG, "08-emoji-default-dark.svg"))
    save(wrap(picker_A("dark", "search"), 480, _h(picker_A("dark", "search"))), os.path.join(SVG, "09-emoji-search-dark.svg"))
    save(wrap(picker_A("light", "categories"), 480, 540, "light"), os.path.join(SVG, "10-emoji-categories-light.svg"))
    save(wrap(picker_A("dark", "recents"), 480, _h(picker_A("dark", "recents"))), os.path.join(SVG, "11-emoji-recents-favourites.svg"))
    save(wrap(picker_A("light", "tones"), 480, 356, "light"), os.path.join(SVG, "12-emoji-tones-light.svg"))

    # --- desktop composites ---
    desk = bg.desktop("dark")
    # popup sits in the lower-right; the editor moves down so the caret is visible
    # below the popup instead of behind it
    desk_ed = bg.desktop("dark")
    save(place(1920, 1200, "dark", desk_ed, 756, 552, popup_A("dark", "default")),
         os.path.join(SVG, "13-desktop-clipboard.svg"))
    save(place(1920, 1200, "dark", desk, 880, 400, picker_A("dark", "default")),
         os.path.join(SVG, "14-desktop-emoji.svg"))

    # --- settings ---
    s = settings("dark")
    b = [rect(0, 0, 880 + 96, 640 + 96, "#131315")]
    b.append('<rect x="48" y="62" width="880" height="640" rx="16" fill="rgba(0,0,0,0.6)" filter="url(#soft)"/>')
    b.append(f'<g transform="translate(48,48)">{body_of(s)}</g>')
    save(doc(976, 736, "".join(b), glass_defs()), os.path.join(SVG, "15-settings-dark.svg"))

    # --- direction comparison ---
    comp_w, comp_h = 2210, 880
    cb = [rect(0, 0, comp_w, comp_h, "#121214")]
    labels = [("A — Continuation", "Adwaita-native · 12 px radius · opaque surface · accent bar on a raised row", 640, 596),
              ("B — Quiet Glass", "16 px radius · translucent + blur · quieter 48 px rows", 660, 560),
              ("C — Slab", "10 px radius · type rail · dense 34 px rows · terminal soul", 720, 566)]
    bodies = [popup_A("dark", "default"), popup_B("dark", "default"), popup_C("dark", "default")]
    xs = [40, 40 + 680, 40 + 680 + 712]
    ys = [120, 120, 120]
    for (label, note, w, h), bd, x, y in zip(labels, bodies, xs, ys):
        cb.append(txt(x - 30, y - 46, label, 20, "#ffffff", 700))
        cb.append(txt(x - 30, y - 24, note, 12.5, "rgba(255,255,255,0.52)", 400))
        cb.append(f'<rect x="{x-22}" y="{y+10}" width="{w}" height="{h}" rx="16" fill="rgba(0,0,0,0.55)" filter="url(#soft)"/>')
        cb.append(f'<g transform="translate({x},{y})">{body_of(bd)}</g>')
    cb.append(txt(40, 800, "All three are rendered at 1:1 logical size. Differences are structural, not decorative: row height, density, type rail, and how selection is expressed.", 12.5, "rgba(255,255,255,0.38)", 400))
    cdefs = "".join(_extract(bd)[0] for bd in bodies)
    cdefs = _dedupe_defs(cdefs, reserved=("soft", "soft2", "blurBg"))
    save(doc(comp_w, comp_h, "".join(cb), glass_defs() + cdefs), os.path.join(SVG, "16-direction-comparison.svg"))

    # --- accessibility / contrast + focus-state spec figure ---
    aw, ah = 1180, 900
    ab = [rect(0, 0, aw, ah, "#131315")]
    ab.append(txt(40, 58, "Accessibility contract — measured, not asserted", 22, "#ffffff", 700))
    ab.append(txt(40, 84, "Every value below was computed with the WCAG 2.1 relative-luminance formula, then used to set the design tokens.", 12.5, "rgba(255,255,255,0.62)", 400))

    rows = [
        ("Token", "Dark", "Light", "Ratio (dark / light)", "Verdict"),
        ("--cliplet-ink",       "rgba(255,255,255,1.0)", "rgba(0,0,0,1.0)",   "15.3:1 / 17.4:1", "AAA"),
        ("--cliplet-ink-dim",   "rgba(255,255,255,0.62)", "rgba(0,0,0,0.55)", "6.84:1 / 4.74:1", "AA"),
        ("--cliplet-ink-faint", "rgba(255,255,255,0.56)", "rgba(0,0,0,0.56)", "5.65:1 / 4.9:1",  "AA — floor"),
        ("--cliplet-hover",     "rgba(255,255,255,0.10)", "rgba(0,0,0,0.055)","1.19:1 (surface only)", "non-text"),
        ("--cliplet-accent",    "#3584e4", "#3584e4", "4.12:1 vs dark bg / 3.77:1 vs light bg", "graphics only"),
    ]
    ty = 130
    ab.append(rect(40, ty - 26, aw - 80, 34, "rgba(255,255,255,0.06)", 6))
    for i, r in enumerate(rows):
        yy = ty + i * 34
        c = "rgba(255,255,255,0.96)" if i == 0 else "rgba(255,255,255,0.80)"
        wt = 700 if i == 0 else 400
        xs2 = [56, 300, 520, 700, 980]
        for j, cell in enumerate(r):
            ab.append(txt(xs2[j], yy + 12, cell, 11.5, c, wt, mono=(j > 0 and i > 0 and j < 3)))
        if i:
            ab.append(rect(40, yy + 22, aw - 80, 1, "rgba(255,255,255,0.07)"))

    ny = 380
    ab.append(txt(40, ny, "Why the accent is not used as a text background", 15, "#ffffff", 700))
    ab.append(txt(40, ny + 24, "White on GNOME blue measures 3.77:1 — below AA for body text. So selection is expressed by a raised surface + 2.5 px accent bar,", 12, "rgba(255,255,255,0.62)", 400))
    ab.append(txt(40, ny + 42, "and full-bleed accent fills are reserved for non-text controls. This is why Direction A rejects the “blue row” pattern by default.", 12, "rgba(255,255,255,0.62)", 400))

    # three states figure
    sy = 470
    ab.append(txt(40, sy, "Three row states, deliberately distinct", 15, "#ffffff", 700))
    import render_clip as R
    tt = Tokens("A", "dark")
    it = R.ITEMS[1]
    specs = [("1  Keyboard focus", "raised surface + 2 px accent ring + accent bar", True, False),
             ("2  Pointer hover", "surface fill only, no ring", False, True),
             ("3  Committed selection (on open)", "raised surface + accent bar", False, False)]
    yy = sy + 26
    for label, note, focused, hovered in specs:
        ab.append(txt(56, yy + 30, label, 12, "rgba(255,255,255,0.86)", 600))
        ab.append(txt(56, yy + 48, note, 11, "rgba(255,255,255,0.5)", 400))
        gx = 400
        row = R.draw_row(tt, gx, yy + 8, 720, 46, it, selected=(not hovered and not focused), hover=hovered, subtitle=False)
        ab.append(row)
        if focused:
            ab.append(rect(gx - 2, yy + 6, 724, 50, "none", 8, "#3584e4", 2))
        yy += 84

    ab.append(txt(40, ah - 34, "Keyboard path: Tab moves focus between the search field, the list and the footer actions. Esc always returns focus to the previously focused window.", 11.5, "rgba(255,255,255,0.42)", 400))
    save(doc(aw, ah, "".join(ab), glass_defs()), os.path.join(SVG, "17-focus-rings-accessibility.svg"))

    if os.path.exists(os.path.join(SVG, "_tmp.svg")):
        os.remove(os.path.join(SVG, "_tmp.svg"))
    architecture_figure()
    unified_figures()
    print("svgs written:", len([f for f in os.listdir(SVG) if f.endswith('.svg')]))


if __name__ == "__main__":
    main()
