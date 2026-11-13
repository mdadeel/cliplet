"""Emoji picker + shared settings window renderers."""
from lib import Tokens, txt, rect, circle, emoji, doc
from render_clip import icon, footer

TONE = ["1F44B", "1F44B_1F3FB", "1F44B_1F3FC", "1F44B_1F3FD", "1F44B_1F3FE"]  # real Noto 3D modifier variants

CATS = [("Smileys", "1F600"), ("People", "1F44B"), ("Nature", "1F33F"), ("Food", "2615"),
        ("Travel", "1F680"), ("Activity", "1F3AF"), ("Objects", "1F4BB"), ("Symbols", "2764")]

GRID = ["1F600", "1F602", "1F60A", "1F60D", "1F643", "1F605", "1F62E", "1F914", "1F44D", "1F44C",
        "1F64F", "1F91D", "1F440", "1F9E0", "1F9D1", "1F4A1", "1F525", "2B50", "2705", "1F389",
        "1F382", "1F3AF", "1F4BB", "1F4C5", "1F4DD", "1F50D", "1F527", "1F4C8", "1F512", "1F4E6",
        "1F4CC", "1F5C2", "1F4C2", "1F5D1", "1F50B", "2699", "1F6E0", "1F680",
        "1F9A5", "1F33B"]


def picker_A(theme="dark", variant="default"):
    t = Tokens("A", theme)
    W = 480
    H = {"search": 336, "empty": 300, "tones": 356, "categories": 540}.get(variant, 452)
    o = []
    o.append(rect(0, 0, W, H, t.bg, t.radius))
    # search row
    o.append(icon(18, 17, 16, "search", t.fg_dim))
    q = "fire" if variant == "search" else ""
    o.append(txt(44, 30, q or "Search emoji", 14, t.fg if q else t.fg_faint, 400))
    o.append(txt(W - 18, 30, "1 902", 11, t.fg_faint, 500, anchor="end"))
    o.append(rect(0, 50, W, 1, t.hair))
    # category rail
    rail_y = 58
    for i, (name, cp) in enumerate(CATS):
        active = (i == 0 and variant != "search")
        cx = 16 + i * 57
        if active:
            o.append(rect(cx - 6, rail_y, 46, 32, "rgba(255,255,255,0.10)" if theme == "dark" else "rgba(0,0,0,0.06)", 7))
        o.append(emoji(cp, cx + 5, rail_y + 3, 24))
        o.append(txt(cx + 17, rail_y + 46, name, 8, t.fg if active else t.fg_faint, 600, anchor="middle"))
    o.append(rect(0, rail_y + 54, W, 1, t.hair))
    y = rail_y + 62
    if variant == "empty":
        o.append(txt(16, y + 12, "NO RESULTS FOR “zzzz”", 10, t.fg_faint, 700, spacing="1.1"))
        o.append(emoji("1F914", 16, y + 34, 34))
        o.append(txt(62, y + 52, "Try a different word — “happy”, “check”, “rocket”.", 12.5, t.fg_dim, 400))
        o.append(txt(62, y + 72, "Emoji names and keywords come from Unicode CLDR.", 11.5, t.fg_faint, 400))
        return doc(W, H, "".join(o))
    if variant == "search":
        o.append(txt(14, y + 10, "BEST MATCHES", 10, t.fg_faint, 700, spacing="1.1"))
        o.append(txt(150, y + 10, "4 results · 3 ms", 10, t.fg_faint, 400))
        y += 22
        for i, cp in enumerate(["1F525", "1F4A1", "1F680", "2B50"]):
            gx = 14 + i * 52
            if i == 0:
                o.append(rect(gx - 3, y - 6, 46, 46, "rgba(255,255,255,0.12)", 8))
                o.append(rect(gx - 3, y - 6, 46, 46, "none", 8, t.sel_bg, 2))
            o.append(emoji(cp, gx + 5, y + 2, 32))
        y += 48
        o.append(txt(14, y + 10, "ALSO MATCHES “fire”", 10, t.fg_faint, 700, spacing="1.1"))
        y += 22
        for i, cp in enumerate(["1F389", "1F382", "1F308", "1F6E0", "2699", "1F4C8"]):
            r_, c = divmod(i, 10)
            o.append(emoji(cp, 14 + c * 45 + 5, y + 5, 30))
        y += 52
        o.append(txt(14, y + 4, "Names and keywords come from Unicode CLDR. Type a word, not a code point.", 11, t.fg_faint, 400))
        o.append(footer(t, 0, H - 38, W, [("↑↓←→", "Move"), ("↵", "Insert"), ("Ctrl+↵", "Copy")], "4 of 1 902"))
        return doc(W, H, "".join(o))

    if variant == "tones":
        # a real tone strip: the same hand in five Noto 3D modifier variants
        o.append(txt(14, y + 10, "DEFAULT SKIN TONE", 10, t.fg_faint, 700, spacing="1.1"))
        o.append(txt(190, y + 10, "applies to hands and people", 10, t.fg_faint, 400))
        y += 20
        for i, cp in enumerate(TONE):
            cx = 12 + i * 52
            sel = (i == 2)
            if sel:
                o.append(rect(cx - 4, y - 6, 48, 48, "rgba(0,0,0,0.06)", 8))
                o.append(rect(cx - 4, y - 6, 48, 48, "none", 8, t.sel_bg, 1.6))
            o.append(emoji(cp, cx + 4, y + 2, 32))
        y += 60
        o.append(txt(14, y + 10, "SAME GLYPH, FIVE TONES", 10, t.fg_faint, 700, spacing="1.1"))
        y += 16
        for i, cp in enumerate(["1F44D_1F3FB", "1F44D_1F3FC", "1F44D_1F3FD", "1F44D_1F3FE", "1F44D_1F3FF",
                                "1F44B_1F3FB", "1F44B_1F3FC", "1F44B_1F3FD", "1F44B_1F3FE", "1F44B_1F3FF"]):
            r_, c = divmod(i, 10)
            o.append(emoji(cp, 12 + c * 45 + 5, y + r_ * 45 + 4, 30))
        y += 52
        o.append(txt(14, y + 6, "Modifiers apply at insertion; the index stores the base codepoint.", 11, t.fg_faint, 400))
        o.append(footer(t, 0, H - 38, W, [("↑↓←→", "Move"), ("↵", "Insert"), ("T", "Cycle tone")], "tone 3 of 5"))
        return doc(W, H, "".join(o))

    if variant == "default":
        o.append(txt(14, y + 10, "FREQUENTLY USED", 10, t.fg_faint, 700, spacing="1.1"))
        o.append(txt(172, y + 10, "by use, not by time", 10, t.fg_faint, 400))
        y += 20
        row = ["1F525", "2705", "1F44D", "1F680", "1F9E0"]
        for i, cp in enumerate(row):
            cx = 12 + i * 44
            o.append(emoji(cp, cx + 5, y + 3, 30))
        y += 52
        o.append(txt(14, y + 10, "SMILEYS & PEOPLE", 10, t.fg_faint, 700, spacing="1.1"))
        o.append(txt(176, y + 10, "category 1 of 8", 10, t.fg_faint, 400))
        y += 20
        cols = 10
        pitch = 45
        for i, cp in enumerate(GRID):
            r, c = divmod(i, cols)
            gy = y + r * pitch
            if gy > H - 66:
                break
            o.append(emoji(cp, 14 + c * pitch + 5, gy + 5, 30))

    # categories browse variant
    if variant == "categories":
        # each category gets glyphs that actually belong to it — the first
        # version repeated unrelated symbols under every heading, which misrepresents
        # how the real picker looks.
        CAT_G = {
            "Smileys": ["1F600", "1F602", "1F60A", "1F60D", "1F970", "1F644", "1F62E", "1F914", "1F929", "1F975"],
            "People":  ["1F44B", "1F44D", "1F44C", "1F64F", "1F91D", "1F9D1", "1F9D2", "1F466", "1F44B_1F3FB", "1F44D_1F3FD"],
            "Nature":  ["1F33F", "1F340", "1F98B", "1F984", "1F308", "1F41B", "2B50", "1F525", "1F331", "1F3D4"],
            "Food":    ["1F34E", "1F355", "1F382", "2615", "1F37A", "1F36A", "1F359", "1F353", "1F950", "1F414"],
            "Travel":  ["1F680", "1F697", "2708", "1F6F5", "1F682", "1F5FA", "1F6A2", "1F30D", "1F3D4", "1F5FD"],
        }
        for r_, (name, cp) in enumerate(CATS[:5]):
            if y + 22 + r_ * 78 > H - 56: break
            o.append(txt(14, y + 10 + r_ * 78, name.upper(), 9, t.fg_faint, 700, spacing="1.1"))
            for c, gcp in enumerate(CAT_G.get(name, GRID[:10])):
                o.append(emoji(gcp, 14 + c * 45 + 5, y + 18 + r_ * 78, 30))
        o.append(footer(t, 0, H - 38, W, [("↑↓←→", "Move"), ("↵", "Insert"), ("Ctrl+↵", "Copy"), ("Tab", "Category")], "browsing by category"))
        return doc(W, H, "".join(o))
    # recents + favourites
    if variant == "recents":
        o.append(txt(16, y + 10, "FAVOURITES", 10, t.fg_faint, 700, spacing="1.1"))
        y += 20
        for i, cp in enumerate(["2764", "1F525", "2705", "1F9E0", "1F680", "1F9D1"]):
            cx = 12 + i * 46
            o.append(emoji(cp, cx + 5, y + 3, 30))
            o.append(icon(cx + 26, y + 28, 10, "star", t.sel_bg))
        y += 58
        o.append(txt(16, y + 10, "RECENTLY USED", 10, t.fg_faint, 700, spacing="1.1"))
        o.append(txt(160, y + 10, "ordered by use, not by time", 10, t.fg_faint, 400))
        y += 20
        for i, cp in enumerate(GRID[:30]):
            r_, c = divmod(i, 10)
            if y + r_ * 45 + 40 > H - 40:
                break
            o.append(emoji(cp, 14 + c * 45 + 5, y + r_ * 45 + 5, 30))
        o.append(footer(t, 0, H - 38, W, [("↑↓←→", "Move"), ("↵", "Insert"), ("F", "Favourite"), ("Ctrl+↵", "Copy")], "shared with history"))
        return doc(W, H, "".join(o))
    return doc(W, H, "".join(o))


def settings(theme="dark"):
    t = Tokens("A", theme)
    W, H = 880, 640
    o = []
    o.append(rect(0, 0, W, H, "#1e1e20" if theme == "dark" else "#fafafb", 12))
    # headerbar
    o.append(f'<path d="M0 12 a12 12 0 0 1 12 -12 h{W-24} a12 12 0 0 1 12 12 v40 h-{W} z" fill="{"#2b2b2e" if theme=="dark" else "#f0eff0"}"/>')
    o.append(rect(0, 51, W, 1, t.hair))
    o.append(txt(W/2, 30, "Cliplet", 13.5, t.fg, 700, anchor="middle"))
    o.append(rect(200, 44, 480, 8, "none"))
    # sidebar
    o.append(rect(0, 52, 232, H - 52, "#232326" if theme == "dark" else "#f2f1f3"))
    o.append(rect(232, 52, 1, H - 52, t.hair))
    nav = [("Clipboard", True), ("Emoji", False), ("Storage", False), ("Privacy", False), ("Shortcuts", False), ("About", False)]
    for i, (name, active) in enumerate(nav):
        y = 76 + i * 40
        if active:
            o.append(rect(8, y - 16, 216, 34, "rgba(255,255,255,0.09)" if theme == "dark" else "rgba(0,0,0,0.06)", 6))
        o.append(txt(24, y + 6, name, 13, t.fg if active else t.fg_dim, 600 if active else 400))
    # content: two groups of rows
    x0 = 264
    cw = W - x0 - 28
    o.append(txt(x0, 92, "Clipboard", 19, t.fg, 700))
    o.append(txt(x0, 112, "History is stored locally and never leaves this device.", 12, t.fg_dim, 400))
    y = 156

    def group(y, rows, header=None):
        out = []
        if header:
            out.append(txt(x0, y + 6, header.upper(), 9.5, t.fg_faint, 700, spacing="1.1"))
            y += 18
        gh = 8 + len(rows) * 56 + 8
        out.append(rect(x0, y, cw, gh, "#28282b" if theme == "dark" else "#ffffff", 10, t.hair, 1))
        for i, (title, sub, ctrl) in enumerate(rows):
            ry = y + 8 + i * 56
            if i:
                out.append(rect(x0 + 16, ry, cw - 32, 1, t.hair))
            out.append(txt(x0 + 16, ry + 23, title, 13, t.fg, 500))
            out.append(txt(x0 + 16, ry + 40, sub, 11, t.fg_dim, 400))
            if ctrl in ("on", "off"):
                sx, sy = x0 + cw - 16 - 46, ry + 20
                out.append(rect(sx, sy, 46, 26, "#3584e4" if ctrl == "on" else ("rgba(255,255,255,0.16)" if theme=="dark" else "rgba(0,0,0,0.16)"), 13))
                out.append(circle(sx + (33 if ctrl == "on" else 13), sy + 13, 11, "#ffffff"))
            elif ctrl:
                out.append(txt(x0 + cw - 34, ry + 30, ctrl, 12, t.fg_dim, 500, anchor="end"))
                out.append(icon(x0 + cw - 24, ry + 22, 12, "chevron", t.fg_faint))
        return "".join(out), y + gh + 22

    g, y2 = group(y, [
        ("Capture clipboard history", "Watch the clipboard while Cliplet is enabled.", "on"),
        ("Store images as thumbnails", "Originals read on paste only. Max 100 MB cache.", "on"),
        ("Sensitive content", "Skip entries marked by password managers.", "on"),
        ("History limit", "200 items", "200"),
    ], "CLIPBOARD")
    o.append(g)
    g2, _ = group(y2, [
        ("Emoji module", "Independent of clipboard history. No shortcut until you set one.", "on"),
        ("Default skin tone", "Five tones", "Medium"),
        ("Recent emoji storage", "Shared with clipboard history storage.", "on"),
    ], "EMOJI")
    o.append(g2)
    return doc(W, H, "".join(o))
