#!/usr/bin/env python3
"""Generate the emoji dataset for the Cliplet review build (DR-28: build-time
generated, no runtime download).

Category assignment is by ordered codepoint-range rules — review-grade, not
CLDR-exact; search quality comes from unicodedata names plus a curated keyword
map. Flags are a small curated set (the full RI-pair grid is not worth 250
entries in a review build).
"""

import os
import sys
import unicodedata

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   os.pardir, "extension", "src", "emojiData.js")

# (id, label, rail glyph, ranges) — first matching rule wins.
CATEGORIES = [
    ("smileys", "Smileys", "😀", [(0x1F600, 0x1F64F), (0x1F900, 0x1F90F), (0x1F920, 0x1F92F),
                                  (0x1F970, 0x1F97F), (0x1F910, 0x1F917), (0x1FAE0, 0x1FAE8),
                                  (0x263A, 0x263A), (0x2639, 0x2639), (0x2764, 0x2764),
                                  (0x2620, 0x2620), (0x1F47B, 0x1F47B), (0x1F493, 0x1F49F),
                                  (0x1F4A4, 0x1F4AF), (0x1F4AB, 0x1F4AF), (0x1F4AC, 0x1F4AD),
                                  (0x1F440, 0x1F445)]),
    ("people", "People", "👋", [(0x1F466, 0x1F487), (0x1F471, 0x1F47A), (0x1F47C, 0x1F47F),
                                (0x1F44A, 0x1F450), (0x1F918, 0x1F91F), (0x1FAF0, 0x1FAF8),
                                (0x1F933, 0x1F933), (0x1F9B0, 0x1F9B9), (0x1F9CD, 0x1F9DF), (0x1F385, 0x1F385),
                                (0x1F936, 0x1F936), (0x1F574, 0x1F575), (0x1F57A, 0x1F57A),
                                (0x261D, 0x261D), (0x26D1, 0x26D1), (0x270A, 0x270D)]),
    ("animals", "Animals", "🐻", [(0x1F400, 0x1F43F), (0x1F980, 0x1F9AA), (0x1F9AE, 0x1F9AF),
                                  (0x1F9A0, 0x1F9A0), (0x1F577, 0x1F578), (0x1F54A, 0x1F54A),
                                  (0x1F300, 0x1F321), (0x1F324, 0x1F32C), (0x2600, 0x2604),
                                  (0x2614, 0x2614), (0x26A1, 0x26A1), (0x26C4, 0x26C5),
                                  (0x26C8, 0x26C8), (0x2B50, 0x2B50), (0x1F31F, 0x1F320)]),
    ("food", "Food", "🍔", [(0x1F32D, 0x1F37F), (0x1F950, 0x1F9CB), (0x2615, 0x2615),
                            (0x1FAD6, 0x1FAD7)]),
    ("activities", "Activities", "⚽", [(0x1F380, 0x1F3AF), (0x1F3B0, 0x1F3C0),
                                        (0x1F3C2, 0x1F3C9), (0x2728, 0x2728),
                                        (0x1F938, 0x1F949), (0x1F94C, 0x1F94F), (0x1F3CA, 0x1F3CC), (0x26BD, 0x26BE), (0x26F3, 0x26F3),
                                        (0x26F7, 0x26F9), (0x1F9AF, 0x1F9AF)]),
    ("travel", "Travel", "🚀", [(0x1F680, 0x1F6FF), (0x1F5FB, 0x1F5FF), (0x1F3D4, 0x1F3D6),
                                (0x2693, 0x2693), (0x2708, 0x2708), (0x1F9ED, 0x1F9ED),
                                (0x26F4, 0x26F4), (0x1F6D1, 0x1F6D1)]),
    ("objects", "Objects", "💡", [(0x1F4A0, 0x1F4AF), (0x1F4B0, 0x1F4FF), (0x1F500, 0x1F5D1),
                                  (0x1F5D4, 0x1F5FA), (0x2328, 0x2328), (0x2702, 0x2702),
                                  (0x2709, 0x2709), (0x1F9FC, 0x1F9FC), (0x1F9EE, 0x1F9EF),
                                  (0x1F52C, 0x1F52F), (0x2699, 0x2699), (0x26EF, 0x26F2),
                                  (0x270F, 0x2712), (0x1F58A, 0x1F58D)]),
    ("symbols", "Symbols", "✅", [(0x2194, 0x21AA), (0x231A, 0x231B), (0x23E9, 0x23FA),
                                  (0x24C2, 0x24C2), (0x25AA, 0x25FE), (0x2934, 0x2935),
                                  (0x2B05, 0x2B55), (0x3030, 0x3030), (0x303D, 0x303D),
                                  (0x3297, 0x3297), (0x3299, 0x3299), (0x1F520, 0x1F51F),
                                  (0x1F52E, 0x1F52F), (0x2705, 0x2705), (0x2714, 0x2714),
                                  (0x2716, 0x2716), (0x274C, 0x274C), (0x274E, 0x274E),
                                  (0x2753, 0x2755), (0x2757, 0x2757), (0x2795, 0x2797),
                                  (0x27B0, 0x27B0), (0x27BF, 0x27BF), (0x2B1B, 0x2B1C),
                                  (0x1F7E0, 0x1F7EB)]),
]

FLAGS = [
    ("1F1FA-1F1F8", "flag united states", "us usa"), ("1F1EC-1F1E7", "flag united kingdom", "uk gb britain"),
    ("1F1E9-1F1EA", "flag germany", "de german"), ("1F1EB-1F1F7", "flag france", "fr french"),
    ("1F1EA-1F1F8", "flag spain", "es spanish"), ("1F1EE-1F1F9", "flag italy", "it italian"),
    ("1F1F5-1F1F9", "flag portugal", "pt"), ("1F1F3-1F1F1", "flag netherlands", "nl dutch"),
    ("1F1E7-1F1EA", "flag belgium", "be"), ("1F1E6-1F1F9", "flag austria", "at"),
    ("1F1E8-1F1ED", "flag switzerland", "ch swiss"), ("1F1F8-1F1EA", "flag sweden", "se"),
    ("1F1F3-1F1F4", "flag norway", "no"), ("1F1E9-1F1F0", "flag denmark", "dk"),
    ("1F1EB-1F1EE", "flag finland", "fi"), ("1F1EE-1F1F8", "flag iceland", "is"),
    ("1F1F5-1F1F1", "flag poland", "pl"), ("1F1E8-1F1FF", "flag czechia", "cz czech"),
    ("1F1FA-1F1E6", "flag ukraine", "ua"), ("1F1F7-1F1FA", "flag russia", "ru"),
    ("1F1F9-1F1F7", "flag turkey", "tr"), ("1F1EE-1F1F7", "flag iran", "ir"),
    ("1F1EE-1F1F1", "flag israel", "il"), ("1F1F8-1F1E6", "flag saudi arabia", "sa"),
    ("1F1E6-1F1EA", "flag united arab emirates", "ae uae"), ("1F1EE-1F1F3", "flag india", "in"),
    ("1F1F5-1F1F0", "flag pakistan", "pk"), ("1F1E8-1F1F3", "flag china", "cn chinese"),
    ("1F1EF-1F1F5", "flag japan", "jp japanese"), ("1F1F0-1F1F7", "flag south korea", "kr korea"),
    ("1F1E6-1F1FA", "flag australia", "au"), ("1F1F3-1F1FF", "flag new zealand", "nz"),
    ("1F1E8-1F1E6", "flag canada", "ca"), ("1F1E7-1F1F7", "flag brazil", "br"),
    ("1F1F2-1F1FD", "flag mexico", "mx"), ("1F1E6-1F1F7", "flag argentina", "ar"),
    ("1F1FF-1F1E6", "flag south africa", "za"), ("1F1EA-1F1EC", "flag egypt", "eg"),
    ("1F1F3-1F1EC", "flag nigeria", "ng"), ("1F1F0-1F1EA", "flag kenya", "ke"),
]

KEYWORDS = {
    0x1F600: ["grin happy smile"], 0x1F602: ["lol laugh cry tears joy"],
    0x1F60A: ["smile happy"], 0x1F60D: ["love heart eyes"],
    0x1F618: ["kiss love"], 0x1F60F: ["smirk"],
    0x1F62D: ["sob cry sad"], 0x1F621: ["angry mad rage"],
    0x1F914: ["hmm think"], 0x1F644: ["eyeroll"],
    0x1F929: ["star struck wow"], 0x1F60E: ["cool sunglasses"],
    0x1F44D: ["thumbsup like yes approve"], 0x1F44E: ["thumbsdown dislike no"],
    0x1F44B: ["wave hello hi bye"], 0x1F44F: ["clap applause bravo"],
    0x1F64F: ["pray thanks please"], 0x1F4AA: ["muscle strong flex"],
    0x1F445: ["tongue"], 0x1F440: ["eyes look"],
    0x2764: ["heart love red"], 0x1F494: ["heartbreak broken"],
    0x1F525: ["fire hot lit"], 0x2728: ["sparkles shiny"],
    0x1F389: ["party celebrate"], 0x1F38A: ["confetti tada"],
    0x1F4AF: ["hundred 100"], 0x2705: ["check yes ok"],
    0x274C: ["cross wrong no x"], 0x2753: ["question"],
    0x1F4A9: ["poop"], 0x1F480: ["skull dead"],
    0x1F680: ["rocket ship launch"], 0x1F31F: ["star"],
    0x1F44C: ["ok hand perfect"], 0x1F91D: ["handshake deal"],
    0x1F4B0: ["money cash"], 0x1F4B8: ["money flying"],
    0x26A1: ["lightning zap fast"], 0x1F5A8: ["printer"],
    0x1F4BB: ["laptop computer"], 0x1F4F1: ["phone mobile"],
    0x1F511: ["key"], 0x1F512: ["lock secure"],
    0x26BD: ["soccer football"], 0x1F3C0: ["basketball"],
    0x1F3AF: ["dart target goal"], 0x1F3AE: ["game controller"],
}

TONE_CAPABLE = set()
for a, b in [(0x1F466, 0x1F46F), (0x1F470, 0x1F478), (0x1F47C, 0x1F47C), (0x1F481, 0x1F483),
             (0x1F44A, 0x1F450), (0x1F485, 0x1F487), (0x1F4AA, 0x1F4AA), (0x1F574, 0x1F575), (0x1F57A, 0x1F57A),
             (0x1F933, 0x1F933),
             (0x1F590, 0x1F590), (0x1F595, 0x1F596), (0x1F645, 0x1F647), (0x1F64B, 0x1F64F),
             (0x1F6A3, 0x1F6A3), (0x1F6B4, 0x1F6B6), (0x1F6C0, 0x1F6C0), (0x1F918, 0x1F91F),
             (0x1F926, 0x1F926), (0x1F930, 0x1F939), (0x1F93C, 0x1F93E), (0x1F9B5, 0x1F9B6),
             (0x1F9B8, 0x1F9B9), (0x1F9CD, 0x1F9CF), (0x1F9D1, 0x1F9D1), (0x261D, 0x261D),
             (0x26F9, 0x26F9), (0x270A, 0x270D), (0x1F3C3, 0x1F3C4), (0x1F3CA, 0x1F3CA),
             (0x1F3CB, 0x1F3CC)]:
    TONE_CAPABLE.update(range(a, b + 1))

SKIP_NAMES = ("VARIATION SELECTOR", "REGIONAL INDICATOR")


def cat_for(cp):
    for cid, label, glyph, ranges in CATEGORIES:
        for a, b in ranges:
            if a <= cp <= b:
                return cid
    return None


def name_of(cp):
    try:
        return unicodedata.name(chr(cp))
    except ValueError:
        return None


def main():
    cats = {cid: {"id": cid, "label": label, "glyph": glyph, "emoji": []}
            for cid, label, glyph, _ in CATEGORIES}
    seen = set()

    for cp in range(0x2000, 0x1FBFF + 1):
        if cp in seen:
            continue
        cid = cat_for(cp)
        if not cid:
            continue
        n = name_of(cp)
        if not n or any(s in n for s in SKIP_NAMES):
            continue
        if unicodedata.category(chr(cp)) in ("Cs", "Co", "Cn"):
            continue
        label = n.lower().replace("_", " ")
        # Joined to a string: `k` is matched with String.includes at
        # runtime, and a JS array literal would make that an exact-element
        # test (the bug that made "lol" miss U+1F602).
        kw = " ".join(KEYWORDS.get(cp, ()))
        cats[cid]["emoji"].append({
            "cp": f"{cp:X}",
            "n": label,
            "k": kw,
            "t": 1 if cp in TONE_CAPABLE else 0,
        })
        seen.add(cp)

    cats["flags"] = {"id": "flags", "label": "Flags", "glyph": "🏁", "emoji": []}
    for hexcp, label, kw in FLAGS:
        parts = hexcp.split("-")
        cats["flags"]["emoji"].append({"cp": "-".join(parts), "n": label, "k": kw, "t": 0})

    total = sum(len(c["emoji"]) for c in cats.values())
    lines = ["// GENERATED by tools/gen_emoji_data.py — do not edit by hand.",
             f"// {total} emoji across {len(cats)} categories (build-time data, DR-28).",
             "export const CATEGORIES = ["]
    for c in cats.values():
        lines.append(f"  {{ id: {c['id']!r}, label: {c['label']!r}, glyph: {c['glyph']!r}, emoji: [")
        for e in c["emoji"]:
            lines.append(f"    {{ cp: {e['cp']!r}, n: {e['n']!r}, k: {e['k']!r}, t: {e['t']} }},")
        lines.append("  ]},")
    lines.append("];")
    lines.append("")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {OUT}: {total} emoji")


if __name__ == "__main__":
    sys.exit(main())
