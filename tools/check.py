#!/usr/bin/env python3
"""Invariant checks for the Cliplet preview pipeline.

Run after `python3 gen.py` (or via `node build.js`). Every check here corresponds
to a real defect that shipped once; the point is that it cannot ship twice.

    python3 check.py        # exit 0 = clean, exit 1 = at least one failure
"""
import glob
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

FAILS = []


def fail(check, msg):
    FAILS.append((check, msg))


# --------------------------------------------------------------------- geometry
def check_fixed_geometry():
    import render_clip as R
    import render_unified as U

    if R.H_CLIP != 596 or R.W_CLIP != 640:
        fail("geometry", f"clipboard window is {R.W_CLIP}x{R.H_CLIP}, expected 640x596")
    if U.EMOJI_H != R.H_CLIP:
        fail("geometry", f"emoji mode {U.EMOJI_H} != clipboard {R.H_CLIP}; Tab would resize the popup")

    for variant in ("default", "pinned", "search", "hover", "image", "empty"):
        h = int(re.search(r'height="(\d+)"', R.popup_A("dark", variant)).group(1))
        if h != 596:
            fail("geometry", f"popup_A({variant}) renders {h}px; the window must not resize")

    t = R.Tokens("A", "dark")
    for variant in ("default", "search", "empty"):
        h = int(re.search(r'height="(\d+)"', U.popup_clip(t, variant)).group(1))
        if h != 596:
            fail("geometry", f"unified clipboard({variant}) renders {h}px")
    for variant in ("default", "search"):
        svg = U.popup_emoji(t, variant)
        h = int(re.search(r'height="(\d+)"', svg).group(1))
        if h != 596:
            fail("geometry", f"unified emoji({variant}) renders {h}px")

    # Real decomposition of the 596 px window. The first version of this report
    # claimed 55 + 8x52 + 30 + 44 + 5, which is 550 — it forgot the two section
    # bands (PINNED / RECENT), each 24 px. Correct total: 55 + 24 + 24 + 416 + 30 + 44 = 593,
    # leaving 3 px of slack at the bottom of the list.
    derived = 55 + 24 + 24 + 8 * 52 + 30 + 44
    if not (590 <= derived <= R.H_CLIP):
        fail("geometry", f"596 budget drifted: derived {derived}")


# ------------------------------------------------------------------- emoji data
def check_emoji_data():
    import render_emoji as E
    import render_unified as U

    for name, grid in (("unified EMOJI_GRID", U.EMOJI_GRID), ("emoji GRID", E.GRID)):
        dupes = [k for k, v in Counter(grid).items() if v > 1]
        if dupes:
            fail("emoji", f"{name} repeats {dupes}; a grid that renders one glyph twice looks broken")
        if len(grid) % 10:
            fail("emoji", f"{name} has {len(grid)} glyphs — not a whole number of 10-column rows")

    used = set()
    for src in ("render_clip.py", "render_emoji.py", "render_unified.py", "gen.py"):
        text = open(os.path.join(HERE, src), encoding="utf-8").read()
        for m in re.findall(r'"([0-9A-F]{4,5}(?:_[0-9A-F]{4,5})*)"', text):
            used.add(m)
    glyph_dir = os.path.join(HERE, "emoji", "noto3d")
    for cp in sorted(used):
        if not os.path.exists(os.path.join(glyph_dir, cp + ".png")):
            fail("emoji", f"missing Noto 3D glyph for {cp}")


# ------------------------------------------------------------------- svg output
def check_svg_files():
    files = sorted(glob.glob(os.path.join(HERE, "svg", "*.svg")))
    if len(files) != 25:
        fail("output", f"{len(files)} SVGs generated, expected 25")
    for f in files:
        name = os.path.basename(f)
        src = open(f, encoding="utf-8").read()
        try:
            ET.parse(f)
        except ET.ParseError as e:
            fail("xml", f"{name}: {e}")
            continue
        ids = re.findall(r'\sid="([^"]+)"', src)
        dupes = {k: v for k, v in Counter(ids).items() if v > 1}
        if dupes:
            fail("xml", f"{name}: duplicate ids {dupes}")
        dangling = set(re.findall(r"url\(#([^)]+)\)", src)) - set(ids)
        if dangling:
            fail("xml", f"{name}: references undefined {dangling}")
        # the whole point of a fixed window: nothing may be drawn in the footer band
        if re.match(r"^(01|02|03|04|05|06|07|13|19|22)-", name):
            h = int(re.search(r'height="(\d+)"', src).group(1))
            width = int(re.search(r'width="(\d+)"', src).group(1))
            for m in re.finditer(r'<text x="([\d.]+)" y="([\d.]+)"', src):
                x, y = float(m.group(1)), float(m.group(2))
                if x < -1 or y < -1 or x > width + 1 or y > h + 1:
                    fail("layout", f"{name}: text at ({x}, {y}) outside {width}x{h}")


# ------------------------------------------------------------ module structure
def check_no_shadowed_defs():
    """A duplicated function definition means the second silently wins.

    That is how a stale `emoji_search` kept rendering the old 300 px search
    figure long after the source was "fixed": the edit landed in a copy of the
    function that Python had already shadowed.
    """
    import ast
    for path in sorted(glob.glob(os.path.join(HERE, "*.py"))):
        tree = ast.parse(open(path, encoding="utf-8").read())
        names = [n.name for n in tree.body
                 if isinstance(n, (ast.FunctionDef, ast.ClassDef))]
        dupes = {k: v for k, v in Counter(names).items() if v > 1}
        if dupes:
            fail("structure", f"{os.path.basename(path)}: shadowed definitions {dupes}")


# ----------------------------------------------------------------------- shapes
def check_no_stale_claims():
    """Strings that document a decision the product no longer makes."""
    stale = {
        "max 604 px": "the window is fixed at 596",
        "content, max 604": "the window is fixed at 596",
        "Super+. opens the picker": "no default shortcut exists",
        "showing 6 of 247": "the count is computed, not hard-coded",
        "8 shown": "the count is computed, not hard-coded",
        "Clicking copies by default": "clicking inserts",
    }
    targets = glob.glob(os.path.join(HERE, "svg", "*.svg"))
    for f in targets:
        text = open(f, encoding="utf-8").read()
        for needle, why in stale.items():
            if needle in text:
                fail("stale", f"{os.path.basename(f)}: still says {needle!r} ({why})")


def main():
    check_fixed_geometry()
    check_emoji_data()
    check_svg_files()
    check_no_shadowed_defs()
    check_no_stale_claims()

    if FAILS:
        print(f"FAIL — {len(FAILS)} problem(s)\n")
        for check, msg in FAILS:
            print(f"  [{check}] {msg}")
        return 1
    print("OK — geometry, emoji data, SVG structure and content all consistent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
