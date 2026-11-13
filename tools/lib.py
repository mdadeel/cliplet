"""Shared drawing primitives for Cliplet UI mockups (SVG -> resvg -> PNG)."""
import html
import os
import re

EMOJI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "emoji", "noto3d")
_emoji_uri = {}


def _prep(path, px=96):
    """Trim, square, resize and palette-quantise a Noto 3D PNG, return data URI."""
    from PIL import Image
    import io
    import base64
    im = Image.open(path).convert("RGBA")
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    s = max(im.size)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((s - im.width) // 2, (s - im.height) // 2))
    canvas = canvas.resize((px, px), Image.LANCZOS)
    q = canvas.quantize(colors=192, method=Image.FASTOCTREE)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def emoji_uri(cp):
    """Data URI for an emoji key, e.g. "1F600" or "1F44D_1F3FD".

    Fails loudly. The first version fell back to the base codepoint when a
    modifier variant was missing, which silently rendered the wrong skin tone —
    a mockup bug that would have shipped as "tone support looks broken".
    """
    if cp in _emoji_uri:
        return _emoji_uri[cp]
    path = os.path.join(EMOJI_DIR, cp + ".png")
    if not os.path.exists(path):
        raise FileNotFoundError(
            "no Noto 3D glyph for %r (expected %s)" % (cp, path))
    uri = _prep(path)
    _emoji_uri[cp] = uri
    return uri


def emoji(cp, x, y, size):
    """Place a Noto Color Emoji (Android 3D set) glyph with its top-left at (x,y)."""
    return ('<image x="%.1f" y="%.1f" width="%.1f" height="%.1f" '
            'preserveAspectRatio="xMidYMid meet" href="%s"/>'
            % (x, y, size, size, emoji_uri(cp)))


def esc(t):
    return html.escape(str(t), quote=True)

SYSTEM_SANS = "'DejaVu Sans','Noto Sans',sans-serif"
MONO = "'DejaVu Sans Mono',monospace"

class Tokens:
    """Design tokens. Three visual directions."""
    def __init__(self, direction="A", theme="dark"):
        self.d = direction
        self.t = theme
        dark = theme == "dark"
        # ---- surfaces ----
        if direction == "A":      # Continuation (Adwaita-native)
            self.radius, self.row_radius, self.ctrl_radius = 12, 6, 6
            self.bg      = "#242424" if dark else "#ffffff"
            self.bg_alt  = "#303030" if dark else "#f6f5f4"
            self.border  = "rgba(255,255,255,0.10)" if dark else "rgba(0,0,0,0.10)"
            self.row_hover = "#3a3a3a" if dark else "#ecebea"
            self.sel_bg  = "#3584e4"
            self.sel_fg  = "#ffffff"
            self.fg      = "#ffffff" if dark else "#1a1a1a"
            self.fg_dim  = "rgba(255,255,255,0.62)" if dark else "rgba(0,0,0,0.55)"
            self.fg_faint= "rgba(255,255,255,0.56)" if dark else "rgba(0,0,0,0.56)"
            self.shadow  = "rgba(0,0,0,0.55)" if dark else "rgba(0,0,0,0.16)"
            self.blur_layer = None
            self.sel_style = "raised"
            self.hair    = "rgba(255,255,255,0.07)" if dark else "rgba(0,0,0,0.07)"
        elif direction == "B":    # Quiet Glass
            self.radius, self.row_radius, self.ctrl_radius = 16, 8, 8
            self.bg      = "rgba(32,33,36,0.78)" if dark else "rgba(252,252,253,0.80)"
            self.bg_alt  = "rgba(255,255,255,0.05)" if dark else "rgba(0,0,0,0.03)"
            self.border  = "rgba(255,255,255,0.16)" if dark else "rgba(255,255,255,0.75)"
            self.row_hover = "rgba(255,255,255,0.07)" if dark else "rgba(0,0,0,0.045)"
            self.sel_bg  = "#3584e4"
            self.sel_fg  = "#ffffff"
            self.fg      = "rgba(255,255,255,0.96)" if dark else "#16181a"
            self.fg_dim  = "rgba(255,255,255,0.58)" if dark else "rgba(0,0,0,0.52)"
            self.fg_faint= "rgba(255,255,255,0.56)" if dark else "rgba(0,0,0,0.56)"
            self.shadow  = "rgba(0,0,0,0.42)" if dark else "rgba(0,0,0,0.14)"
            self.blur_layer = True
            self.sel_style = "tinted"
            self.hair    = "rgba(255,255,255,0.08)" if dark else "rgba(0,0,0,0.06)"
        else:                      # C — Slab (dense command palette)
            self.radius, self.row_radius, self.ctrl_radius = 10, 4, 4
            self.bg      = "#1e1e21" if dark else "#fbfbf9"
            self.bg_alt  = "#26262a" if dark else "#f1f1ee"
            self.border  = "rgba(255,255,255,0.13)" if dark else "rgba(0,0,0,0.14)"
            self.row_hover = "#2c2c31" if dark else "#ecece9"
            self.sel_bg  = "#3584e4"
            self.sel_fg  = "#ffffff"
            self.fg      = "#ededed" if dark else "#17171a"
            self.fg_dim  = "rgba(255,255,255,0.55)" if dark else "rgba(0,0,0,0.52)"
            self.fg_faint= "rgba(255,255,255,0.56)" if dark else "rgba(0,0,0,0.56)"
            self.shadow  = "rgba(0,0,0,0.60)" if dark else "rgba(0,0,0,0.20)"
            self.blur_layer = None
            self.sel_style = "bar"
            self.hair    = "rgba(255,255,255,0.06)" if dark else "rgba(0,0,0,0.08)"


def txt(x, y, s, size=13, fill="#fff", weight=400, anchor="start", mono=False, spacing=0, opacity=None):
    fam = MONO if mono else SYSTEM_SANS
    op = f' opacity="{opacity}"' if opacity is not None else ""
    ls = f' letter-spacing="{spacing}"' if spacing else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{ls}{op}>{esc(s)}</text>')


def rect(x, y, w, h, fill="none", r=0, stroke=None, sw=1, opacity=None):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    op = f' opacity="{opacity}"' if opacity is not None else ""
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" '
            f'fill="{fill}"{st}{op}/>')


def circle(cx, cy, r, fill="none", stroke=None, sw=1, opacity=None):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    op = f' opacity="{opacity}"' if opacity is not None else ""
    return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}"{st}{op}/>'


def path(d, fill="none", stroke=None, sw=1, opacity=None, cap="round"):
    st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linecap="{cap}" stroke-linejoin="round"' if stroke else ""
    op = f' opacity="{opacity}"' if opacity is not None else ""
    return f'<path d="{d}" fill="{fill}"{st}{op}/>'


def panel_shadow(x, y, w, h, r, color, spread=26, dy=10, op=1.0):
    """Soft ambient shadow via blurred dark rounded rect (resvg supports feGaussianBlur)."""
    return f'''<rect x="{x}" y="{y+dy}" width="{w}" height="{h}" rx="{r}" fill="{color}"
        opacity="{0.55*op}" filter="url(#soft)"/>'''


_DEF_RE = re.compile(
    r'<(filter|linearGradient|radialGradient|clipPath)\s+id="([^"]+)".*?</\1>', re.S)


def _dedupe_defs(svg, reserved=()):
    """Keep only the first definition of each id.

    Composed scenes (a desktop plus a popup) can each bring a definition of
    `soft`, `thumbA` and friends. XML forbids duplicate ids, and browsers are
    entitled to ignore every one after the first. This collapses them so a
    rendered result never depends on which copy a renderer happened to pick.
    """
    seen = set(reserved)
    def repl(m):
        ident = m.group(2)
        if ident in seen:
            return ""
        seen.add(ident)
        return m.group(0)
    return _DEF_RE.sub(repl, svg)


def doc(w, h, body, defs_extra=""):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<defs>
  <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="14"/>
  </filter>
  <filter id="soft2" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="6"/>
  </filter>
  <filter id="blurBg" x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur stdDeviation="18"/>
  </filter>
  {defs_extra}
</defs>
{body}
</svg>'''


def save(svg, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(svg)


def trunc(s, n):
    return s if len(s) <= n else s[: n - 1] + "…"
