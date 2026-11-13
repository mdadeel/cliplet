"""Unified Cliplet popup — one shell, two modes, a switcher control.

Geometry (logical units, 1x):
  W 640 · segmented switcher lives in the header · footer is mode-aware
  H 596 in BOTH modes. The window is fixed: it never resizes with history
  length, and it never resizes when you press Tab. 8 rows visible.
"""
from lib import txt, rect, emoji, doc
from render_clip import (icon, keycap, ITEMS, PINNED,
                         draw_row, section_row, FADE_DEFS, H_CLIP, W_CLIP)

W = W_CLIP
FH = 44                     # footer band
SEG_W, SEG_H = 186, 30      # segmented switcher
EMOJI_H = H_CLIP     # identical by construction: the switcher must never resize the window

EMOJI_GRID = ["1F600", "1F602", "1F60A", "1F60D", "1F643", "1F605", "1F62E", "1F914", "1F44D", "1F44C",
              "1F64F", "1F91D", "1F440", "1F9E0", "1F9D1", "1F4A1", "1F525", "2B50", "2705", "1F389",
              "1F382", "1F3AF", "1F4BB", "1F4C5", "1F4DD", "1F50D", "1F527", "1F4C8", "1F512", "1F4E6",
              "1F4CC", "1F5C2", "1F4C2", "1F5D1", "1F50B", "2699", "1F6E0", "1F680", "1F33F", "1F41B",
              "1F984", "1F308", "2764", "2615", "1F4AF", "1F4CE", "1F4E4", "1F44B", "1F9A5", "1F3FB"]

CATS = [("Smileys", "1F600"), ("People", "1F44B"), ("Nature", "1F33F"), ("Food", "2615"),
        ("Travel", "1F680"), ("Activity", "1F3AF"), ("Objects", "1F4BB"), ("Symbols", "2764")]


def switcher(t, x, y, mode, w=SEG_W, h=SEG_H):
    """Segmented control: [ clipboard | emoji ]. The active half is raised."""
    o = []
    o.append(rect(x, y, w, h, "rgba(255,255,255,0.07)" if t.t == "dark" else "rgba(0,0,0,0.045)", 7,
                  t.hair, 1))
    half = (w - 4) / 2
    for i, (kind, label) in enumerate([("clipboard", "Clipboard"), ("smiley", "Emoji")]):
        hx = x + 2 + i * half
        active = (i == 0 and mode == "clip") or (i == 1 and mode == "emoji")
        if active:
            o.append(rect(hx, y + 2, half, h - 4,
                          "rgba(255,255,255,0.16)" if t.t == "dark" else "rgba(255,255,255,0.95)", 5,
                          "rgba(255,255,255,0.10)" if t.t == "dark" else "rgba(0,0,0,0.08)", 1))
        col = (t.fg if active else t.fg_faint)
        o.append(icon(hx + 11, y + h/2 - 7, 14, kind, col, 1.35))
        o.append(txt(hx + 31, y + h/2 + 4, label, 11.5, col, 600 if active else 500))
    return "".join(o)


def header(t, mode, query="", placeholder="Search clipboard", count="247 items"):
    o = []
    ix = 18
    o.append(icon(ix, 16, 17, "search", t.fg_dim))
    if query:
        o.append(txt(ix + 28, 32, query, 14.5, t.fg, 400))
        o.append(rect(ix + 28 + len(query) * 7.9 + 1, 18, 1.6, 18, t.fg, 1, opacity="0.8"))
    else:
        o.append(txt(ix + 28, 32, placeholder, 14.5, t.fg_faint, 400))
    o.append(switcher(t, W - SEG_W - 18, 12, "clip" if mode == "clip" else "emoji"))
    o.append(rect(0, 54, W, 1, t.hair))
    return "".join(o)


def footer(t, hints, right=""):
    o = [rect(0, 0, W, 1, t.hair)]
    cx = 16
    for k, lbl in hints:
        if k:
            kc, kw = keycap(cx, 12, k, t)
            o.append(kc)
            cx += kw + 5
        o.append(txt(cx, 24, lbl, 10.5, t.fg_dim, 400))
        cx += len(lbl) * 5.5 + 13
    if right:
        o.append(txt(W - 16, 24, right, 10.5, t.fg_faint, 400, anchor="end"))
    return "".join(o)


# --------------------------------------------------------------------------- clipboard mode
def clip_body(t, variant, top, bottom):
    """Returns (markup, end_y)."""
    c = []
    y = top + 14
    if variant == "empty":
        mid = top + (bottom - top) / 2
        c.append(icon(W/2 - 21, mid - 78, 42, "copy", t.fg_faint, 1.2))
        c.append(txt(W/2, mid - 2, "Nothing copied yet", 15, t.fg, 600, anchor="middle"))
        c.append(txt(W/2, mid + 22, "Copy text, links or images and they’ll appear here.", 12.5, t.fg_dim, 400, anchor="middle"))
        c.append(txt(W/2, mid + 42, "History stays on this device.", 12.5, t.fg_faint, 400, anchor="middle"))
        return "".join(c), bottom, 0

    if variant == "search":
        c.append(section_row(t, 0, y + 6, W, "Results", "5 matches"))
        y += 22
        res = [
            dict(kind="code", text="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9ok", app="Terminal", age="2 days ago", mono=True),
            dict(kind="text", text="Generating a new SSH key pair — gh auth & ssh-keygen notes", app="Firefox", age="3 days ago"),
            dict(kind="text", text="~/.ssh/config  ·  Host gitlab  HostName gitlab.gnome.org", app="Text Editor", age="5 days ago"),
            dict(kind="link", text="docs.github.com/en/authentication/connecting-to-github-with-ssh", app="Firefox", age="1 week ago"),
            dict(kind="text", text="ssh-add --apple-use-keychain (macOS note, ignore)", app="Slack", age="2 weeks ago"),
        ]
        for i, it in enumerate(res):
            if y + 48 > bottom - 4:
                break
            c.append(draw_row(t, 8, y, W - 16, 48, it, selected=(i == 0)))
            y += 52
        return "".join(c), y, len(res)

    # pinned — one representative row: pinning is an exception, and showing three
    # pushed RECENT to the middle of a fixed-height window
    c.append(section_row(t, 0, y + 6, W, "Pinned", str(len(PINNED))))
    y += 24
    for it in PINNED:
        if y + 42 > bottom - 4:
            break
        c.append(draw_row(t, 8, y, W - 16, 42, it, subtitle=False))
        y += 42
    y += 14

    c.append(section_row(t, 0, y + 6, W, "Recent", "newest first"))
    y += 24
    shown = 0
    for i, it in enumerate(ITEMS):
        if y + 48 > bottom - 4:
            break
        sel = (i == 0)
        hov = (i == 1 and variant == "hover")
        c.append(draw_row(t, 8, y, W - 16, 48, it, selected=sel, hover=hov, actions=hov))
        y += 52
        shown += 1
    c.append(rect(0, bottom - 30, W, 30, "url(#fadeA)"))
    return "".join(c), y, shown


def popup_clip(t, variant="default", H=None):
    if H is None:
        H = H_CLIP
    o = [FADE_DEFS, rect(0, 0, W, H, t.bg, t.radius)]
    o.append(header(t, "clip", query="ssh key" if variant == "search" else "",
                    count="" if variant == "empty" else "247 items"))
    body_top, body_bot = 55, H - FH
    o.append(f'<clipPath id="clipU"><rect x="0" y="{body_top}" width="{W}" height="{body_bot-body_top}"/></clipPath>')
    body, end_y, shown_n = clip_body(t, variant, body_top, body_bot)
    o.append(f'<g clip-path="url(#clipU)">{body}</g>')
    if end_y > body_bot:
        pass                                        # clipped; the fade signals more
    hints = ([("Esc", "Close"), ("P", "Privacy settings")] if variant == "empty" else
             [("↑↓", "Navigate"), ("↵", "Paste"), ("P", "Pin"), ("Tab", "Emoji")])
    right = "Nothing leaves this device" if variant == "empty" else (f"{shown_n} of 247" if shown_n else "")
    o.append(f'<g transform="translate(0,{H-FH})">{footer(t, hints, right)}</g>')
    return doc(W, H, "".join(o))


# --------------------------------------------------------------------------- emoji mode
def emoji_body(t, top, bottom):
    c = []
    y = top + 10
    RAIL_H = 62
    cols, pitch, glyph = 10, 55, 34
    gx0 = (W - (cols * pitch)) / 2

    # ---- category rail, horizontally centred ----
    rail_w = len(CATS) * 62
    rx0 = (W - rail_w) / 2 + 12
    for i, (name, cp) in enumerate(CATS):
        cx = rx0 + i * 62
        if i == 0:
            c.append(rect(cx - 6, y, 50, 34, "rgba(255,255,255,0.10)" if t.t == "dark" else "rgba(0,0,0,0.055)", 8))
        c.append(emoji(cp, cx + 6, y + 4, 26))
        c.append(txt(cx + 19, y + 50, name, 8.5, t.fg if i == 0 else t.fg_faint, 600, anchor="middle"))
    y += RAIL_H
    c.append(rect(0, y - 4, W, 1, t.hair))
    y += 8

    # ---- recents: the prominent band ----
    c.append(txt(18, y + 10, "RECENT", 10, t.fg_faint, 700, spacing="1.1"))
    c.append(txt(88, y + 10, "tap to insert at the cursor", 10, t.fg_faint, 400))
    y += 20
    band_h = 52
    c.append(rect(12, y - 4, W - 24, band_h + 8, "rgba(255,255,255,0.045)" if t.t == "dark" else "rgba(0,0,0,0.028)", 10))
    recent = ["1F525", "2705", "1F44D", "1F680", "1F9E0", "1F389", "1F4A1"]
    for i, cp in enumerate(recent):
        cx = 22 + i * 62
        if i == 0:
            c.append(rect(cx - 6, y - 2, 52, band_h, "rgba(53,132,228,0.22)", 8))
            c.append(rect(cx - 6, y - 2, 52, band_h, "none", 8, t.sel_bg, 1.6))
        c.append(emoji(cp, cx, y, 40))
    y += band_h + 16

    # ---- all emoji grid ----
    c.append(txt(18, y + 10, "SMILEYS & PEOPLE", 10, t.fg_faint, 700, spacing="1.1"))
    c.append(txt(W - 18, y + 10, "all 1 902 · ← → to browse", 10, t.fg_faint, 400, anchor="end"))
    y += 22
    for i, cp in enumerate(EMOJI_GRID):
        r_, col = divmod(i, cols)
        gy = y + r_ * 56
        if gy + 44 > bottom - 2:
            break
        c.append(emoji(cp, gx0 + col * pitch + (pitch - glyph) / 2, gy, glyph))
    c.append(rect(0, bottom - 30, W, 30, "url(#fadeA)"))
    return "".join(c)






def popup_emoji(t, variant="default", H=EMOJI_H):
    o = [FADE_DEFS, rect(0, 0, W, H, t.bg, t.radius)]
    o.append(header(t, "emoji",
                    query="fire" if variant == "search" else "",
                    placeholder="Search emoji", count="1 902"))
    body_top, body_bot = 55, H - FH
    o.append(f'<clipPath id="clipE"><rect x="0" y="{body_top}" width="{W}" height="{body_bot-body_top}"/></clipPath>')
    if variant == "search":
        body = emoji_search(t, body_top, body_bot)
        hints = [("↑↓←→", "Move"), ("↵", "Insert"), ("Ctrl+↵", "Copy"), ("Tab", "Clipboard")]
        right = "4 results · 3 ms"
    else:
        body = emoji_body(t, body_top, body_bot)
        hints = [("↑↓←→", "Move"), ("↵", "Insert"), ("T", "Skin tone"), ("Tab", "Clipboard")]
        right = "Insert at cursor"
    o.append(f'<g clip-path="url(#clipE)">{body}</g>')
    o.append(f'<g transform="translate(0,{H-FH})">{footer(t, hints, right)}</g>')
    return doc(W, H, "".join(o))


def emoji_search(t, top, bottom):
    """Search results fill the fixed window instead of leaving two thirds of it empty."""
    c = []
    y = top + 14
    c.append(txt(18, y + 10, "BEST MATCHES", 10, t.fg_faint, 700, spacing="1.1"))
    c.append(txt(160, y + 10, "4 results \u00b7 3 ms", 10, t.fg_faint, 400))
    y += 24
    cols, pitch, glyph = 10, 55, 34
    gx0 = (W - (cols * pitch)) / 2
    for i, cp in enumerate(["1F525", "1F4A1", "1F680", "2B50"]):
        gx = gx0 + i * pitch + (pitch - glyph) / 2
        if i == 0:
            c.append(rect(gx - 7, y - 6, glyph + 14, glyph + 14, "rgba(53,132,228,0.20)", 9))
            c.append(rect(gx - 7, y - 6, glyph + 14, glyph + 14, "none", 9, t.sel_bg, 1.6))
        c.append(emoji(cp, gx, y, glyph))
    y += 58

    c.append(txt(18, y + 10, "ALSO MATCHES \u201cfire\u201d", 10, t.fg_faint, 700, spacing="1.1"))
    y += 24
    also = ["1F389", "1F382", "1F308", "1F6E0", "2699", "1F4C8", "2615", "1F37A", "1F355", "1F950",
            "1F33F", "1F331", "1F30D", "1F5FA", "1F697", "1F682", "2708", "1F6A2", "1F9A5", "1F984"]
    rows = 0
    for i, cp in enumerate(also):
        r_, col = divmod(i, cols)
        gy = y + r_ * 56
        if gy + glyph > bottom - 56:          # room for the two footnote lines
            break
        c.append(emoji(cp, gx0 + col * pitch + (pitch - glyph) / 2, gy, glyph))
        rows = r_ + 1
    y += 56 * rows + 10

    c.append(rect(18, y, W - 36, 1, t.hair))
    y += 22
    c.append(txt(18, y, "Names and keywords come from Unicode CLDR \u2014 type a word, not a code point.", 11, t.fg_faint, 400))
    c.append(txt(18, y + 20, "Matching runs on the base codepoint; skin-tone modifiers are applied at insert", 11, t.fg_faint, 400))
    return "".join(c)
