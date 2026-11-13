"""Cliplet clipboard popup renderers — three visual directions, light/dark.
Layout is computed, not hand-placed: rows fill the available height and clip."""
from lib import Tokens, txt, rect, circle, path, doc, trunc

# ----------------------------------------------------------------------------- icons
def icon(x, y, s, kind, color, sw=1.4):
    o = []
    if kind == "search":
        o.append(circle(x + s*0.42, y + s*0.42, s*0.30, "none", color, sw))
        o.append(path(f"M{x+s*0.64} {y+s*0.64} L{x+s*0.92} {y+s*0.92}", stroke=color, sw=sw))
    elif kind == "text":
        for i, wf in enumerate([1.0, 0.84, 0.6]):
            o.append(path(f"M{x+s*0.14} {y+s*(0.28+i*0.22)} H{x+s*(0.14+0.72*wf)}", stroke=color, sw=sw))
    elif kind == "link":
        o.append(path(f"M{x+s*0.46} {y+s*0.54} a{s*0.19} {s*0.19} 0 0 1 0 -{s*0.26} l{s*0.09} -{s*0.09} a{s*0.19} {s*0.19} 0 0 1 {s*0.27} {s*0.27} l-{s*0.05} {s*0.05}", stroke=color, sw=sw))
        o.append(path(f"M{x+s*0.54} {y+s*0.46} a{s*0.19} {s*0.19} 0 0 1 0 {s*0.26} l-{s*0.09} {s*0.09} a{s*0.19} {s*0.19} 0 0 1 -{s*0.27} -{s*0.27} l{s*0.05} -{s*0.05}", stroke=color, sw=sw))
    elif kind == "code":
        o.append(path(f"M{x+s*0.38} {y+s*0.26} L{x+s*0.16} {y+s*0.5} L{x+s*0.38} {y+s*0.74}", stroke=color, sw=sw))
        o.append(path(f"M{x+s*0.62} {y+s*0.26} L{x+s*0.84} {y+s*0.5} L{x+s*0.62} {y+s*0.74}", stroke=color, sw=sw))
    elif kind == "image":
        o.append(rect(x+s*0.14, y+s*0.20, s*0.72, s*0.60, "none", s*0.10, color, sw))
        o.append(path(f"M{x+s*0.20} {y+s*0.72} L{x+s*0.40} {y+s*0.50} L{x+s*0.56} {y+s*0.66} L{x+s*0.66} {y+s*0.56} L{x+s*0.80} {y+s*0.72}", stroke=color, sw=sw))
        o.append(circle(x + s*0.33, y + s*0.36, s*0.05, color))
    elif kind == "lock":
        o.append(rect(x+s*0.22, y+s*0.46, s*0.56, s*0.36, "none", s*0.08, color, sw))
        o.append(path(f"M{x+s*0.34} {y+s*0.46} v-{s*0.12} a{s*0.16} {s*0.16} 0 0 1 {s*0.32} 0 v{s*0.12}", stroke=color, sw=sw))
        o.append(circle(x + s*0.5, y + s*0.63, s*0.05, color))
    elif kind == "pin":
        o.append(path(f"M{x+s*0.36} {y+s*0.14} h{s*0.28} l-{s*0.05} {s*0.24} l{s*0.13} {s*0.16} h-{s*0.44} l{s*0.13} -{s*0.16} z", fill=color))
        o.append(path(f"M{x+s*0.5} {y+s*0.54} V{y+s*0.86}", stroke=color, sw=sw))
    elif kind == "pin_off":
        o.append(path(f"M{x+s*0.34} {y+s*0.16} h{s*0.30} l-{s*0.05} {s*0.22} l{s*0.13} {s*0.14} h-{s*0.46} l{s*0.13} -{s*0.14} z", fill=color, opacity="0.45"))
        o.append(path(f"M{x+s*0.5} {y+s*0.52} V{y+s*0.86}", stroke=color, sw=sw, opacity="0.45"))
    elif kind == "copy":
        o.append(rect(x+s*0.16, y+s*0.16, s*0.46, s*0.46, "none", s*0.08, color, sw))
        o.append(path(f"M{x+s*0.38} {y+s*0.70} v{s*0.14} h{s*0.46} v-{s*0.46} h-{s*0.14}", stroke=color, sw=sw))
    elif kind == "trash":
        o.append(path(f"M{x+s*0.18} {y+s*0.28} H{x+s*0.82}", stroke=color, sw=sw))
        o.append(path(f"M{x+s*0.30} {y+s*0.28} v-{s*0.10} h{s*0.40} v{s*0.10}", stroke=color, sw=sw))
        o.append(path(f"M{x+s*0.26} {y+s*0.28} l{s*0.05} {s*0.52} h{s*0.38} l{s*0.05} -{s*0.52}", stroke=color, sw=sw))
    elif kind == "close":
        o.append(path(f"M{x+s*0.28} {y+s*0.28} L{x+s*0.72} {y+s*0.72} M{x+s*0.72} {y+s*0.28} L{x+s*0.28} {y+s*0.72}", stroke=color, sw=sw))
    elif kind == "chevron":
        o.append(path(f"M{x+s*0.40} {y+s*0.26} L{x+s*0.62} {y+s*0.5} L{x+s*0.40} {y+s*0.74}", stroke=color, sw=sw))
    elif kind == "star":
        o.append(path(f"M{x+s*0.5} {y+s*0.14} l{s*0.11} {s*0.24} l{s*0.26} {s*0.04} l-{s*0.19} {s*0.18} l{s*0.05} {s*0.26} l-{s*0.23} -{s*0.14} l-{s*0.23} {s*0.14} l{s*0.05} -{s*0.26} l-{s*0.19} -{s*0.18} l{s*0.26} -{s*0.04} z", fill=color))
    elif kind == "clipboard":
        o.append(rect(x+s*0.20, y+s*0.24, s*0.44, s*0.56, "none", s*0.08, color, sw))
        o.append(path(f"M{x+s*0.36} {y+s*0.24} v-{s*0.08} h{s*0.16} v{s*0.08}", stroke=color, sw=sw))
        for i in range(3):
            o.append(path(f"M{x+s*0.29} {y+s*(0.40+i*0.13)} H{x+s*0.55}", stroke=color, sw=sw))
        o.append(rect(x+s*0.56, y+s*0.34, s*0.26, s*0.42, "none", s*0.06, color, sw))
    elif kind == "smiley":
        o.append(circle(x+s*0.5, y+s*0.5, s*0.34, "none", color, sw))
        o.append(circle(x+s*0.38, y+s*0.42, s*0.045, color))
        o.append(circle(x+s*0.62, y+s*0.42, s*0.045, color))
        o.append(path(f"M{x+s*0.36} {y+s*0.60} a{s*0.17} {s*0.17} 0 0 0 {s*0.28} 0", stroke=color, sw=sw))
    elif kind == "clock":
        o.append(circle(x+s*0.5, y+s*0.5, s*0.32, "none", color, sw))
        o.append(path(f"M{x+s*0.5} {y+s*0.31} V{y+s*0.5} H{x+s*0.65}", stroke=color, sw=sw))
    return "".join(o)


# --- fixed window geometry -------------------------------------------------
# The window does not resize with history length. One size, always, like Windows
# (Win+V) and macOS clipboard managers: a popup that changes height between
# sessions moves its own footer and its own selection under the user's finger.
W_CLIP = 640
H_CLIP = 596
BODY_TOP = 55           # header band
FH = 44                 # footer band
ROWS_VISIBLE = 8        # 8 x 52 px row pitch fills 416 px exactly
MAX_CLIP_H = H_CLIP     # kept for older call sites
TOTAL_ITEMS = "247"

FADE_DEFS = ("<defs><linearGradient id=\"fadeA\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">"
             "<stop offset=\"0%\" stop-color=\"#000\" stop-opacity=\"0\"/>"
             "<stop offset=\"100%\" stop-color=\"#000\" stop-opacity=\"0.55\"/></linearGradient></defs>")

TYPE_ICON = {"link": "link", "code": "code", "text": "text", "secret": "lock",
             "image": "image", "color": "text", "file": "text"}


def keycap(x, y, label, t, size=11):
    w = {1: 16, 2: 24, 3: 32}.get(len(label), 40)
    return (rect(x, y, w, 17, t.bg_alt if t.t == "dark" else "rgba(0,0,0,0.055)", 4, t.hair, 1) +
            txt(x + w/2, y + 12.2, label, size, t.fg_dim, 600, anchor="middle")), w


# ----------------------------------------------------------------------------- data
ITEMS = [
    dict(kind="link", text="gitlab.gnome.org/GNOME/mutter/-/merge_requests/3551",
         app="Firefox", age="12 s ago"),
    dict(kind="code", text="git rebase -i origin/main --autosquash", app="Terminal", age="1 min ago", mono=True),
    dict(kind="text", text="Ship the research deck before Friday — feasibility matrix plus three directions.",
         app="Text Editor", age="4 min ago"),
    dict(kind="image", text="Screenshot from 2026-11-06 14-02-11.png", app="Screenshot", age="9 min ago", thumb=True),
    # Demo secret: deliberately NOT a real provider key format — mockups get
    # published, and GitHub push protection rejects anything matching live
    # key patterns (sk_live_/pk_live_/…) even in sample content.
    dict(kind="secret", text="demo_secret_4f2a9c1d8e7b3a2f5c6d0e1b2a3c4d5e", app="Bitwarden",
         age="11 min ago", masked="demo_secret_••••••••••••••••••••4f2a"),
    dict(kind="text", text="Standup is 10:15 — agenda in the doc, bring the loader numbers.", app="Thunderbird", age="26 min ago"),
    dict(kind="color", text="#3584e4", app="Colour picker", age="41 min ago", swatch=True),
    dict(kind="file", text="cliplet-feasibility-matrix.odt", app="Files", age="58 min ago"),
    dict(kind="text", text="docker compose up -d --build && docker compose logs -f api", app="Terminal", age="1 h ago", mono=True),
    dict(kind="link", text="https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/popupMenu.js", app="Firefox", age="2 h ago"),
    dict(kind="text", text="Thanks — I'll take the accessibility review and send notes by Monday.", app="Thunderbird", age="3 h ago"),
    dict(kind="image", text="Screenshot from 2026-11-06 09-11-40.png", app="Screenshot", age="5 h ago", thumb=True),
    dict(kind="link", text="codeberg.org/cliplet/design-notes/-/issues/41", app="Firefox", age="6 h ago"),
    dict(kind="text", text="/usr/share/gnome-shell/extensions/cliplet@gnome.shell", app="Files", age="Yesterday", mono=True),
    dict(kind="code", text="SELECT id, kind, hash FROM items ORDER BY used_at DESC LIMIT 200;", app="Terminal",
         age="Yesterday", mono=True),
    dict(kind="file", text="friday-sync-notes.pdf", app="Document Viewer", age="Yesterday"),
    dict(kind="text", text="Priya — can you check whether the mutter MR landed before the freeze?", app="Element",
         age="Yesterday"),
    dict(kind="link", text="docs.github.com/en/get-started/writing-on-github", app="Firefox", age="2 days ago"),
    dict(kind="text", text="gnome-shell --version && gsettings get org.gnome.shell keybindings", app="Terminal",
         age="2 days ago", mono=True),
    dict(kind="color", text="#e62d42", app="Colour picker", age="2 days ago", swatch=True),
    dict(kind="secret", text="demo_token_9dK2mQ4rT7vX1bN8sZ3wY6pL0aC5eF2h", app="GitHub CLI", age="2 days ago",
         masked="demo_token_••••••••••••••••••eF2h"),
    dict(kind="text", text="Remember: the popup is fixed-height, so the fade is the only scroll signal.", app="Text Editor",
         age="3 days ago"),
    dict(kind="file", text="cliplet-research-package.tar.zst", app="Files", age="3 days ago"),
]

PINNED = [
    dict(kind="text", text="ayesha.rahman@cliplet.dev", app="email", age="pinned", pinned=True),
    dict(kind="code", text="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0…", app="public key",
         age="pinned", mono=True, pinned=True),
]


def chip_fill(t):
    return "rgba(255,255,255,0.085)" if t.t == "dark" else "rgba(0,0,0,0.05)"


def sel_colors(t, selected):
    """Three genuinely different selection languages, one per direction."""
    if not selected:
        return dict(fill=None, fg=t.fg, dim=t.fg_dim, faint=t.fg_faint, bar=None)
    if t.sel_style == "raised":          # A — Adwaita: neutral raised surface + accent bar
        return dict(fill=("rgba(255,255,255,0.13)" if t.t == "dark" else "rgba(0,0,0,0.075)"),
                    fg=t.fg, dim=t.fg_dim, faint=t.fg_faint, bar=t.sel_bg)
    if t.sel_style == "tinted":          # B — accent wash under glass
        return dict(fill=("rgba(53,132,228,0.30)" if t.t == "dark" else "rgba(53,132,228,0.16)"),
                    fg=t.fg, dim=t.fg_dim, faint=t.fg_faint, bar=None)
    return dict(fill=("rgba(255,255,255,0.06)" if t.t == "dark" else "rgba(0,0,0,0.04)"),
                fg=t.fg, dim=t.fg_dim, faint=t.fg_faint, bar=t.sel_bg)   # C — accent bar


def draw_row(t, x, y, w, h, it, selected=False, hover=False, actions=False,
             numbered=None, dense=False, subtitle=True):
    o = []
    c = sel_colors(t, selected)
    r = t.row_radius
    if c["fill"]:
        o.append(rect(x, y, w, h, c["fill"], r))
    elif hover:
        o.append(rect(x, y, w, h, t.row_hover, r))
    if c["bar"]:
        o.append(rect(x, y + 3, 2.5, h - 6, c["bar"], 1.5))

    ch = 26
    cx, cy = x + 12, y + (h - ch) / 2
    if it["kind"] == "image":
        o.append(f'<rect x="{cx}" y="{cy}" width="{ch}" height="{ch}" rx="5" fill="url(#thumbA)"/>')
    elif it.get("swatch"):
        o.append(rect(cx, cy, ch, ch, chip_fill(t), 5))
        o.append(circle(cx + ch/2, cy + ch/2, ch*0.30, "#3584e4"))
    else:
        o.append(rect(cx, cy, ch, ch, chip_fill(t), 5))
        o.append(icon(cx + ch*0.22, cy + ch*0.22, ch*0.56, TYPE_ICON[it["kind"]], c["dim"]))

    tx = cx + ch + 12
    if numbered is not None:
        o.append(txt(x + 7, y + h/2 + 3.5, str(numbered), 10, c["faint"], 700, mono=True))
        tx += 12

    body = it.get("masked") or it["text"]
    if dense:
        o.append(txt(tx, y + h/2 + 4.2, trunc(body, 62), 12.5, c["fg"], 400,
                     mono=bool(it.get("mono"))))
        o.append(txt(x + w - 12, y + h/2 + 4, it["age"], 10.5, c["faint"], 400, anchor="end", mono=True))
    else:
        ty = y + (h/2 + 4.8 if not subtitle else 21)
        o.append(txt(tx, ty, trunc(body, 58), 13, c["fg"], 500, mono=bool(it.get("mono"))))
        if subtitle:
            o.append(txt(tx, y + 37, f'{it["app"]} · {it["age"]}', 11, c["dim"], 400))

    if actions:
        for i, k in enumerate(["trash", "copy", "pin"]):
            bx = x + w - 16 - i * 27
            o.append(rect(bx - 16, y + h/2 - 12, 22, 22,
                          "rgba(255,255,255,0.16)" if t.t == "dark" else "rgba(0,0,0,0.07)", 5))
            o.append(icon(bx - 12, y + h/2 - 8, 14, k, c["fg"]))
    elif it.get("pinned"):
        o.append(icon(x + w - 26, y + h/2 - 7, 14, "pin", c["faint"]))
    return "".join(o)


def header(t, x, y, w, query="", placeholder="Search clipboard", count="247 items",
           show_filter=True, hh=54):
    o = []
    ix = x + 18
    o.append(icon(ix, y + hh/2 - 8, 17, "search", t.fg_dim))
    if query:
        o.append(txt(ix + 28, y + hh/2 + 5, query, 14.5, t.fg, 400))
        o.append(rect(ix + 28 + len(query) * 7.9 + 1, y + hh/2 - 9, 1.6, 18, t.fg, 1, opacity="0.8"))
    else:
        o.append(txt(ix + 28, y + hh/2 + 5, placeholder, 14.5, t.fg_faint, 400))
    if show_filter:
        o.append(txt(x + w - 18, y + hh/2 + 4.5, count, 11.5, t.fg_faint, 500, anchor="end"))
    o.append(rect(x, y + hh, w, 1, t.hair))
    return "".join(o), hh


def section_row(t, x, y, w, label, right=""):
    o = [txt(x + 16, y, label.upper(), 9.8, t.fg_faint, 700, spacing="1.15")]
    if right:
        o.append(txt(x + w - 16, y, right, 9.8, t.fg_faint, 400, anchor="end"))
    return "".join(o)


def footer(t, x, y, w, hints, right=""):
    o = [rect(x, y, w, 1, t.hair)]
    cx = x + 16
    for k, lbl in hints:
        if k:
            kc, kw = keycap(cx, y + 12, k, t)
            o.append(kc)
            cx += kw + 5
        o.append(txt(cx, y + 24, lbl, 10.5, t.fg_dim, 400))
        cx += len(lbl) * 5.5 + 13
    if right:
        o.append(txt(x + w - 16, y + 24, right, 10.5, t.fg_faint, 400, anchor="end"))
    return "".join(o)


# ----------------------------------------------------------------------------- popup A
def popup_A(theme="dark", variant="default", H=None):
    """Direction A — Continuation. 640 x 596, fixed. Content never resizes it."""
    t = Tokens("A", theme)
    W = W_CLIP
    if H is None:
        H = H_CLIP
    o = [FADE_DEFS]
    o.append(rect(0, 0, W, H, t.bg, t.radius))
    hdr, hh = header(t, 0, 0, W, query="ssh key" if variant == "search" else "",
                     show_filter=(variant != "empty"))
    o.append(hdr)
    body_top = hh + 1
    body_bot = H - FH
    o.append(f'<clipPath id="clipA"><rect x="0" y="{body_top}" width="{W}" height="{body_bot-body_top}"/></clipPath>')
    c = ['<g clip-path=\"url(#clipA)\">']
    y = body_top + 14

    if variant == "empty":
        mid = body_top + (body_bot - body_top) / 2
        c.append(icon(W/2 - 21, mid - 74, 42, "copy", t.fg_faint, 1.2))
        c.append(txt(W/2, mid + 2, "Nothing copied yet", 15, t.fg, 600, anchor="middle"))
        c.append(txt(W/2, mid + 26, "Copy text, links or images and they’ll appear here.", 12.5, t.fg_dim, 400, anchor="middle"))
        c.append(txt(W/2, mid + 46, "History stays on this device.", 12.5, t.fg_faint, 400, anchor="middle"))
        c.append('</g>')
        o.append("".join(c))
        o.append(footer(t, 0, H - FH, W, [("Esc", "Close"), ("P", "Privacy settings")], "Nothing leaves this device"))
        return doc(W, H, "".join(o))

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
            c.append(draw_row(t, 8, y, W - 16, 48, it, selected=(i == 0)))
            y += 52
        c.append('</g>')
        o.append("".join(c))
        o.append(footer(t, 0, H - FH, W, [("↑↓", "Navigate"), ("↵", "Paste"), ("Tab", "Emoji")], "5 results · 8 ms"))
        return doc(W, H, "".join(o))

    # ---- pinned section ----
    pinned = {"image": PINNED[:1], "search": PINNED[:0], "empty": PINNED[:0]}.get(variant, PINNED)
    c.append(section_row(t, 0, y + 6, W, "Pinned", str(len(pinned))))
    y += 24
    for it in pinned:
        c.append(draw_row(t, 8, y, W - 16, 42, it, subtitle=False))
        y += 42
    y += 14

    # ---- recent section ----
    c.append(section_row(t, 0, y + 6, W, "Recent", "newest first"))
    y += 24
    items = (ITEMS[3:4] + ITEMS[0:2]) if variant == "image" else ITEMS
    row_h = 48
    shown = 0
    for i, it in enumerate(items):
        if y + row_h > body_bot - 4:
            break
        sel = (i == 0)
        hov = (i == 1 and variant == "hover")
        act = (i == 1 and variant == "hover")
        c.append(draw_row(t, 8, y, W - 16, row_h, it, selected=sel, hover=hov, actions=act))
        y += row_h + 4
        shown += 1
        if variant == "image" and i == 0:
            c.append(rect(20, y + 2, W - 40, 178, "rgba(255,255,255,0.045)" if theme == "dark" else "rgba(0,0,0,0.03)", 8))
            c.append(f'<rect x="28" y="{y+10}" width="{W-56}" height="152" rx="6" fill="url(#thumbA)"/>')
            c.append(txt(40, y + 152, "3840 × 2160 · PNG · 2.4 MB", 10.5, "rgba(255,255,255,0.92)", 600))
            y += 180
    # scroll affordance when the list is clipped
    c.append(rect(0, body_bot - 30, W, 30, "url(#fadeA)"))
    c.append('</g>')
    o.append("".join(c))
    if y > body_bot:                               # content overflowed the fixed window
        pass                                        # (clipped by body_bot; fade already drawn)
    o.append(footer(t, 0, H - FH, W,
                    [("↑↓", "Navigate"), ("↵", "Paste"), ("P", "Pin"), ("Alt↵", "Plain text")],
                    f"{shown} of {TOTAL_ITEMS}"))
    return doc(W, H, "".join(o))


# ----------------------------------------------------------------------------- popup B
def popup_B(theme="dark", variant="default"):
    """Direction B — Quiet Glass. 660 wide, 44 px rows, grouped by day."""
    t = Tokens("B", theme)
    W = 660
    FH = 46
    H = 560 if variant != "empty" else 330
    o = []
    o.append(f'<rect x="0" y="0" width="{W}" height="{H}" rx="{t.radius}" fill="url(#glass{theme})"/>')
    o.append(rect(0.5, 0.5, W - 1, H - 1, "none", t.radius,
                  "rgba(255,255,255,0.20)" if theme == "dark" else "rgba(255,255,255,0.95)", 1))
    o.append(icon(24, 24, 18, "search", t.fg_dim))
    q = "ssh key" if variant == "search" else ""
    o.append(txt(56, 39, q or "Search everything you’ve copied", 15.5,
                 t.fg if q else t.fg_faint, 400))
    o.append(rect(0, 64, W, 1, t.hair))
    body_top, body_bot = 65, H - FH
    o.append(f'<clipPath id="clipB"><rect x="0" y="{body_top}" width="{W}" height="{body_bot-body_top}"/></clipPath>')
    c = ['<g clip-path=\"url(#clipB)\">']
    y = body_top + 14
    if variant == "empty":
        c.append(icon(W/2-20, y + 46, 40, "copy", t.fg_faint, 1.2))
        c.append(txt(W/2, y + 118, "Your clipboard is empty", 16, t.fg, 600, anchor="middle"))
        c.append(txt(W/2, y + 142, "Everything you copy shows up here — locally, never uploaded.", 12.5, t.fg_dim, 400, anchor="middle"))
        c.append('</g>')
        o.append("".join(c))
        o.append(footer(t, 0, H - FH, W, [("↵", "Paste"), ("Esc", "Close")], "On-device"))
        return doc(W, H, "".join(o))

    if variant == "search":
        groups = [("3 matches", [
            dict(kind="code", text="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0", app="Terminal", age="2 d", mono=True),
            dict(kind="text", text="Generating a new SSH key pair — notes", app="Firefox", age="3 d"),
            dict(kind="link", text="docs.github.com/…/connecting-to-github-with-ssh", app="Firefox", age="1 w")])]
    else:
        groups = [("Today", ITEMS[:5]), ("Yesterday", ITEMS[5:8])]
    first = True
    for label, items in groups:
        if y > body_bot - 120:
            break
        c.append(txt(24, y + 10, label, 10.5, t.fg_faint, 700, spacing="1.2"))
        y += 20
        for it in items:
            if y + 48 > body_bot - 4:
                break
            sel = first
            ccol = sel_colors(t, sel)
            h = 48
            if ccol["fill"]:
                c.append(rect(12, y, W - 24, h - 4, ccol["fill"], t.row_radius))
            cx = 28
            c.append(rect(cx, y + 7, 26, 26, "rgba(255,255,255,0.10)" if theme == "dark" else "rgba(0,0,0,0.055)", 8))
            c.append(icon(cx + 6, y + 13, 14, TYPE_ICON[it["kind"]], ccol["dim"]))
            c.append(txt(68, y + 20, trunc(it["text"], 52), 13.5, ccol["fg"], 500, mono=bool(it.get("mono"))))
            c.append(txt(68, y + 35, it["app"], 11, ccol["dim"], 400))
            c.append(txt(W - 28, y + 28, it["age"], 11, ccol["dim"], 400, anchor="end"))
            y += h
            first = False
    c.append('</g>')
    o.append("".join(c))
    o.append(footer(t, 0, H - FH, W, [("↑↓", "Move"), ("↵", "Paste"), ("Alt↵", "Plain text")], "247 items"))
    return doc(W, H, "".join(o))


# ----------------------------------------------------------------------------- popup C
def popup_C(theme="dark", variant="default"):
    """Direction C — Slab. 720 wide, type rail, dense 34 px numbered rows."""
    t = Tokens("C", theme)
    W = 720
    H = 566 if variant != "empty" else 330
    RAIL = 152
    FH = 34
    o = []
    o.append(rect(0, 0, W, H, t.bg, t.radius))
    q = "ssh" if variant == "search" else ""
    o.append(txt(20, 34, "›", 17, t.fg_faint, 700))
    o.append(txt(40, 34, q or "clipboard", 15, t.fg if q else t.fg_faint, 500, mono=True))
    if q:
        o.append(rect(40 + len(q)*9.2 + 2, 20, 8, 18, t.fg, 2, opacity="0.8"))
    o.append(txt(W - 20, 32, "247 · 8 ms", 11, t.fg_faint, 400, anchor="end", mono=True))
    o.append(rect(0, 48, W, 1, t.border))

    body_top, body_bot = 49, H - FH
    # rail
    o.append(rect(0, body_top, RAIL, body_bot - body_top,
                  "rgba(255,255,255,0.028)" if theme == "dark" else "rgba(0,0,0,0.02)"))
    o.append(rect(RAIL, body_top, 1, body_bot - body_top, t.border))
    rail = [("text", "All", 247), ("text", "Text", 198), ("link", "Links", 21),
            ("code", "Code", 14), ("image", "Images", 9), ("lock", "Hidden", 5)]
    ry = body_top + 14
    for i, (k, lbl, n) in enumerate(rail):
        active = (i == 0)
        if active:
            o.append(rect(8, ry, RAIL - 16, 26, "rgba(255,255,255,0.10)" if theme == "dark" else "rgba(0,0,0,0.06)", 4))
        o.append(icon(18, ry + 8, 12, k, t.fg if active else t.fg_dim, 1.3))
        o.append(txt(38, ry + 17, lbl, 12, t.fg if active else t.fg_dim, 600 if active else 400))
        o.append(txt(RAIL - 18, ry + 17, str(n), 10.5, t.fg_faint, 400, anchor="end", mono=True))
        ry += 30
    o.append(f'<clipPath id="clipC"><rect x="{RAIL+1}" y="{body_top}" width="{W-RAIL-1}" height="{body_bot-body_top}"/></clipPath>')
    c = ['<g clip-path=\"url(#clipC)\">']
    items = ITEMS[:14] if variant != "search" else [
        dict(kind="code", text="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9ok", app="Terminal", age="2 d", mono=True),
        dict(kind="text", text="Generating a new SSH key pair — gh auth & ssh-keygen notes", app="Firefox", age="3 d"),
        dict(kind="text", text="~/.ssh/config  ·  Host gitlab  HostName gitlab.gnome.org", app="Text Editor", age="5 d"),
        dict(kind="link", text="docs.github.com/en/authentication/connecting-to-github-with-ssh", app="Firefox", age="1 w"),
    ]
    y = body_top + 8
    for i, it in enumerate(items):
        if y + 34 > body_bot:
            break
        c.append(draw_row(t, RAIL + 2, y, W - RAIL - 2, 34, it, selected=(i == 0), numbered=i + 1, dense=True))
        if i < len(items) - 1:
            c.append(rect(166, y + 33, W - 182, 1, t.hair))
        y += 34
    c.append('</g>')
    o.append("".join(c))
    o.append(rect(0, H - FH, W, 1, t.border))
    cx = 166
    for k, lbl in [("↑↓", "move"), ("↵", "paste"), ("p", "pin"), ("x", "delete"), ("esc", "close")]:
        o.append(txt(cx, H - 12, f"{k} {lbl}", 10.5, t.fg_faint, 500, mono=True))
        cx += len(k + lbl) * 6.6 + 20
    return doc(W, H, "".join(o))
