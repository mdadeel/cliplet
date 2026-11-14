// Emoji module logic: build-time data (DR-28), recents ordered by USE COUNT
// (§09 #16), favourites as a badge (no tab), tone applied at insertion time
// (§13 Directive 4: the index stores the base codepoint; the modifier is
// appended at insertion).
//
// Perf contract (the popup rebuilds the grid on every keystroke): nothing on
// the per-entry path may touch GSettings, re-derive a glyph, or allocate a
// search haystack. Everything a cell needs is precomputed once here; the
// popup reads settings through `tone` / `favouriteSet()` — once per build,
// not once per cell.

import GLib from 'gi://GLib';

import { CATEGORIES } from './emojiData.js';
import { EXTRA_CATEGORIES } from './emojiExtra.js';

const TONE_MODIFIERS = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const RECENTS_SLOTS = 7;

// 'cp' hex list ('1F44B', '1F1FA-1F1F8') -> the character(s) themselves.
function glyphOf(cp) {
    let out = '';
    for (const h of cp.split('-'))
        out += String.fromCodePoint(parseInt(h, 16));
    return out;
}

export class EmojiModule {
    constructor({ settings }) {
        this._settings = settings;
        this._categories = [...CATEGORIES, ...EXTRA_CATEGORIES];
        this._flat = [];
        this._byCp = new Map();
        this._droppedDuplicates = 0;
        for (const cat of this._categories) {
            const catHay = `${cat.id} ${cat.label}`.toLowerCase();
            const kept = [];
            for (const e of cat.emoji) {
                // Normalise the table IN PLACE. It is a build-time constant
                // this module owns, and the old `{...e}` copies meant the same
                // emoji was two different objects depending on whether it
                // arrived via a category or via search — an identity trap for
                // anything comparing entries across modes (and 1.6k wasted
                // objects on every enable()).
                //
                // `k` is a String in emojiExtra.js and the flags table, but an
                // Array for the generated entries that carry curated keywords.
                // Array.prototype.includes is an EXACT-ELEMENT test, so
                // keyword search silently never matched: "lol" missed 😂,
                // "laugh" missed 😂, "muscle" missed 💪.
                if (Array.isArray(e.k))
                    e.k = e.k.join(' ');
                // `cp` is the identity for recents/favourites/dedupe: fold it
                // to one case so a hand-authored entry and a generated one
                // describing the same character cannot coexist as two entries.
                const cp = e.cp.toUpperCase();
                if (cp !== e.cp)
                    e.cp = cp;
                e.cat = cat.id;
                e.g = glyphOf(e.cp);              // base glyph; tone is appended on top
                e._n = e.n.toLowerCase();         // names are lowercase in the table, but don't bet the index on it
                e._hay = `${e._n} ${e.k} ${catHay}`;

                // First occurrence wins. The hand-authored Characters tab
                // overlaps the generated Symbols/Animals/Objects ranges on 21
                // codepoints (↔ ▲ ▼ ◆ ● ○ ☀ ☁ ☂ ☃ ☄ ☠ ⚙ ✂ ✉ ✔ …). Without
                // this the same glyph appeared twice — once as a colour emoji,
                // once in text style — and _byCp resolved recents/favourites
                // to whichever copy happened to be built last.
                if (this._byCp.has(e.cp)) {
                    this._droppedDuplicates++;
                    continue;
                }
                this._byCp.set(e.cp, e);
                this._flat.push(e);
                kept.push(e);
            }
            // The category arrays themselves must not offer the dropped copy:
            // the grid is built straight from `cat.emoji`.
            if (kept.length !== cat.emoji.length)
                cat.emoji = kept;
        }
    }

    // Duplicates suppressed at index time (see the constructor).
    get droppedDuplicates() { return this._droppedDuplicates; }

    get categories() { return this._categories; }

    get flat() { return this._flat; }

    // ---- settings snapshots: ONE read per grid build, not one per cell ----

    get tone() { return this._settings.get_int('emoji-tone'); }

    favouriteSet() { return new Set(this._settings.get_strv('emoji-favourites')); }

    // `tone` may be passed explicitly (tone strip swatches); otherwise it is
    // read here — callers building a grid should pass the snapshot instead.
    glyph(entry, tone = null) {
        if (tone === null)
            tone = this._settings.get_int('emoji-tone');
        const base = entry.g ?? glyphOf(entry.cp);
        return (tone > 0 && entry.t) ? base + TONE_MODIFIERS[tone] : base;
    }

    // Values persisted before the case fold may be lowercase — resolve both.
    _lookup(cp) {
        return this._byCp.get(cp) || this._byCp.get(String(cp).toUpperCase()) || null;
    }

    recents() {
        const counts = this._settings.get_value('emoji-recents').deep_unpack();
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, RECENTS_SLOTS)
            .map(([cp]) => this._lookup(cp))
            .filter(Boolean);
    }

    favourites() {
        return this._settings.get_strv('emoji-favourites')
            .map((cp) => this._lookup(cp))
            .filter(Boolean);
    }

    isFavourite(entry) {
        return this.favouriteSet().has(entry.cp);
    }

    toggleFavourite(entry) {
        const favs = this._settings.get_strv('emoji-favourites');
        const i = favs.findIndex((cp) => this._lookup(cp) === entry);
        if (i >= 0) favs.splice(i, 1);
        else favs.push(entry.cp);
        this._settings.set_strv('emoji-favourites', favs);
        return i < 0;
    }

    bumpUse(entry) {
        const counts = this._settings.get_value('emoji-recents').deep_unpack();
        counts[entry.cp] = (counts[entry.cp] || 0) + 1;
        this._settings.set_value('emoji-recents',
            new GLib.Variant('a{si}', counts));
    }

    // Search: name + keyword + category, one substring test per token against
    // a haystack precomputed at index time. Prefix matches rank first.
    //
    // Two gjs-specific notes: `localeCompare` was the tie-breaker, and in
    // SpiderMonkey each call is far more expensive than a `<` comparison
    // (no cached Intl.Collator) — with 1400 hits that alone is tens of ms per
    // keystroke. Emoji names are ASCII, so a plain comparison is equivalent.
    search(query) {
        const q = query.trim().toLowerCase();
        if (!q)
            return [];
        // Hoisted per token: ` t` used to be re-concatenated per entry.
        const probes = q.split(/\s+/).map((t) => ({ t, sp: ` ${t}` }));
        const scored = [];
        for (const e of this._flat) {
            const hay = e._hay;
            let score = 0;
            let ok = true;
            for (const p of probes) {
                if (!hay.includes(p.t)) {
                    ok = false;
                    break;
                }
                const n = e._n;
                // exact name match outranks a word inside a longer name —
                // searching "shrug" must beat "crying shrug"
                score += n === p.t ? 3
                    : (n.startsWith(p.t) || n.includes(p.sp) ? 2 : 0);
                score += e.k.includes(p.t) ? 1 : 0;
            }
            if (ok)
                scored.push([score, e]);
        }
        scored.sort((a, b) => b[0] - a[0] ||
            (a[1]._n < b[1]._n ? -1 : a[1]._n > b[1]._n ? 1 : 0));
        return scored.map(([, e]) => e);
    }
}

export { RECENTS_SLOTS, TONE_MODIFIERS };
