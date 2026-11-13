"""A believable GNOME 51 desktop scene used to host the popup mockups."""
from lib import txt, rect, circle, path

W, H = 1920, 1200


def _defs():
    """Scene-specific definitions only.

    This function used to emit a whole <defs> block *plus* the shared filters,
    which are already defined by lib.doc(). The scene is a fragment: lib.doc()
    owns the root element and the global filter set, and the composer hoists
    whatever is returned here. Defining `soft` twice is an XML error.
    """
    return """      <linearGradient id="wall" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stop-color="#12203a"/>
        <stop offset="45%" stop-color="#1d2b4d"/>
        <stop offset="75%" stop-color="#33265a"/>
        <stop offset="100%" stop-color="#1a1730"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.30" cy="0.30" r="0.62">
        <stop offset="0%" stop-color="#4b7fd6" stop-opacity="0.40"/>
        <stop offset="100%" stop-color="#4b7fd6" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glow2" cx="0.80" cy="0.80" r="0.55">
        <stop offset="0%" stop-color="#9a5bd6" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="#9a5bd6" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="panelg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.52"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.28"/>
      </linearGradient>"""


def _files_window(x, y, w, h):
    s = []
    s.append(f'<rect x="{x}" y="{y+18}" width="{w}" height="{h}" rx="12" fill="rgba(0,0,0,0.45)" filter="url(#soft)"/>')
    s.append(rect(x, y, w, h, "#1e1e20", 12))
    s.append(rect(x, y, w, h, "none", 12, "rgba(255,255,255,0.09)"))
    s.append(f'<path d="M{x} {y+12} a12 12 0 0 1 12 -12 h{w-24} a12 12 0 0 1 12 12 v44 h-{w} z" fill="#2b2b2e"/>')
    s.append(rect(x, y + 55, w, 1, "rgba(255,255,255,0.08)"))
    for i, c in enumerate(["#e0625e", "#e0b23f", "#57b45c"]):
        s.append(circle(x + 22 + i * 19, y + 28, 6.5, c, opacity="0.9"))
    s.append(txt(x + w / 2, y + 33, "Files — Projects", 13, "rgba(255,255,255,0.86)", 600, anchor="middle"))
    s.append(rect(x, y + 56, 236, h - 56, "#232326"))
    s.append(rect(x + 236, y + 56, 1, h - 56, "rgba(255,255,255,0.07)"))
    s.append(rect(x + 14, y + 74, 208, 34, "rgba(255,255,255,0.10)", 8))
    s.append(txt(x + 32, y + 96, "Home", 13, "#ffffff", 500))
    for i, name in enumerate(["Documents", "Downloads", "Pictures", "Projects", "Trash"]):
        s.append(txt(x + 32, y + 138 + i * 32, name, 13, "rgba(255,255,255,0.56)"))
    s.append(txt(x + 268, y + 96, "Projects", 15, "#ffffff", 700))
    names = ["cliplet", "design-system", "meeting-notes.md", "screenshots", "research", "builds"]
    subs = ["Folder — 4 items", "Folder — 12 items", "Markdown — 8.2 kB", "Folder — 39 items",
            "Folder — 6 items", "Folder — 3 items"]
    for i in range(len(names)):
        ry = y + 130 + i * 68
        s.append(rect(x + 268, ry, w - 300, 54, "rgba(255,255,255,0.045)", 8))
        if i == 2:
            s.append(rect(x + 268, ry, w - 300, 54, "rgba(53,132,228,0.16)", 8))
        icon_bg = rect(x + 282, ry + 11, 32, 32, "rgba(255,255,255,0.13)", 6)
        s.append(icon_bg)
        s.append(txt(x + 328, ry + 24, names[i], 13, "rgba(255,255,255,0.90)", 500))
        s.append(txt(x + 328, ry + 42, subs[i], 11, "rgba(255,255,255,0.42)"))
    return "".join(s)


def _editor_window(x, y, w, h):
    s = []
    s.append(f'<rect x="{x}" y="{y+20}" width="{w}" height="{h}" rx="12" fill="rgba(0,0,0,0.50)" filter="url(#soft)"/>')
    s.append(rect(x, y, w, h, "#26262a", 12))
    s.append(rect(x, y, w, h, "none", 12, "rgba(255,255,255,0.11)"))
    s.append(f'<path d="M{x} {y+12} a12 12 0 0 1 12 -12 h{w-24} a12 12 0 0 1 12 12 v40 h-{w} z" fill="#303035"/>')
    s.append(rect(x, y + 51, w, 1, "rgba(255,255,255,0.08)"))
    s.append(txt(x + w / 2, y + 28, "meeting-notes.md", 12.5, "rgba(255,255,255,0.82)", 600, anchor="middle"))
    lines = [
        ("# Cliplet — research review", 700, "rgba(255,255,255,0.92)"),
        ("", 400, ""),
        ("Feasibility matrix for the clipboard module is", 400, "rgba(255,255,255,0.62)"),
        ("attached below. Open questions:", 400, "rgba(255,255,255,0.62)"),
        ("", 400, ""),
        ("- Can we restore and paste into the", 400, "rgba(255,255,255,0.62)"),
        ("  previously focused window?", 400, "rgba(255,255,255,0.62)"),
        ("- Where does the emoji picker end and", 400, "rgba(255,255,255,0.62)"),
        ("  GTK begin?", 400, "rgba(255,255,255,0.62)"),
    ]
    for i, (line, wt, col) in enumerate(lines):
        if line:
            s.append(txt(x + 28, y + 88 + i * 25, line, 12.5, col, wt, mono=True))
    # caret after the last line
    s.append(rect(x + 28, y + 88 + 9 * 25 - 4, 1.8, 16, "#ffffff", 1, opacity="0.85"))
    return "".join(s)


def _panel():
    s = [rect(0, 0, W, 30, "url(#panelg)"),
         txt(20, 20, "Activities", 13.5, "#ffffff", 600),
         txt(W / 2, 20, "Thu Nov 6   2:14 PM", 13.5, "#ffffff", 600, anchor="middle")]
    rx = W - 300
    s.append(txt(rx, 20, "en", 12, "rgba(255,255,255,0.85)", 600))
    s.append(path(f"M{rx+30} 17 a7 7 0 0 1 10 0", stroke="#fff", sw=2))
    s.append(path(f"M{rx+33} 20 a4 4 0 0 1 4 0", stroke="#fff", sw=2))
    s.append(circle(rx + 35, 22, 1.6, "#fff"))
    s.append(path(f"M{rx+58} 13 v8 l5 4 v-16 z", fill="#fff"))
    s.append(path(f"M{rx+68} 13 a6 6 0 0 1 0 8", stroke="#fff", sw=1.8))
    s.append(rect(rx + 84, 12, 20, 10, "none", 2.5, "#fff", 1.4))
    s.append(rect(rx + 86, 14, 13, 6, "#fff", 1.5))
    s.append(rect(rx + 105, 15, 2, 4, "#fff", 1))
    s.append(rect(rx + 116, 6, 150, 18, "rgba(255,255,255,0.12)", 9))
    s.append(txt(rx + 191, 19, "100%  ▾", 11.5, "#fff", 600, anchor="middle"))
    return "".join(s)


def desktop(theme="dark", editor_top=None):
    """Returns a FRAGMENT, not a document: lib.doc() supplies <svg> and <defs>."""
    s = ['<defs>' + _defs() + '</defs>']
    s.append(rect(0, 0, W, H, "url(#wall)"))
    s.append(rect(0, 0, W, H, "url(#glow)"))
    s.append(rect(0, 0, W, H, "url(#glow2)"))
    s.append(path("M0 990 Q 480 910 960 968 T 1920 936 L1920 1200 L0 1200 Z", fill="#0d0b18", opacity="0.35"))
    s.append(_files_window(150, 110, 1160, 580))
    # a popup anchored in the upper area would otherwise overlap the editor window,
    # which contradicts the "opens at the caret" story those figures tell
    s.append(_editor_window(340, editor_top if editor_top is not None else 590, 880,
                            470 if editor_top is None else 470))
    s.append(_panel())
    return "".join(s)
