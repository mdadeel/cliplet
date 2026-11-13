// Emoji module logic: build-time data (DR-28), recents ordered by USE COUNT
// (§09 #16), favourites as a badge (no tab), tone applied at insertion time
// (§13 Directive 4: the index stores the base codepoint; the modifier is
// appended at insertion).

import GLib from 'gi://GLib';

import { CATEGORIES } from './emojiData.js';
import { EXTRA_CATEGORIES } from './emojiExtra.js';

const TONE_MODIFIERS = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const RECENTS_SLOTS = 7;

export class EmojiModule {
    constructor({ settings }) {
        this._settings = settings;
        this._categories = [...CATEGORIES, ...EXTRA_CATEGORIES];
        this._flat = [];
        for (const cat of this._categories) {
            for (const e of cat.emoji) {
                this._flat.push({ ...e, cat: cat.id });
            }
        }
        this._byCp = new Map(this._flat.map((e) => [e.cp, e]));
    }

    get categories() { return this._categories; }

    glyph(entry, tone = null) {
        if (tone === null) tone = this._settings.get_int('emoji-tone');
        const parts = entry.cp.split('-').map((h) => String.fromCodePoint(parseInt(h, 16)));
        if (tone > 0 && entry.t) {
            parts.push(TONE_MODIFIERS[tone]);
        }
        return parts.join('');
    }

    recents() {
        const counts = this._settings.get_value('emoji-recents').deep_unpack();
        const entries = Object.entries(counts)
            .filter(([cp]) => this._byCp.has(cp))
            .sort((a, b) => b[1] - a[1])
            .slice(0, RECENTS_SLOTS)
            .map(([cp]) => this._byCp.get(cp));
        return entries;
    }

    favourites() {
        return this._settings.get_strv('emoji-favourites')
            .filter((cp) => this._byCp.has(cp))
            .map((cp) => this._byCp.get(cp));
    }

    isFavourite(entry) {
        return this._settings.get_strv('emoji-favourites').includes(entry.cp);
    }

    toggleFavourite(entry) {
        const favs = this._settings.get_strv('emoji-favourites');
        const i = favs.indexOf(entry.cp);
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

    // Search: name + keyword + category label; prefix matches rank first.
    search(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const tokens = q.split(/\s+/);
        const scored = [];
        for (const e of this._flat) {
            const hay = `${e.n} ${e.k}`;
            let score = 0;
            let ok = true;
            for (const t of tokens) {
                const inKw = e.k.includes(t);
                // exact name match outranks a word inside a longer name —
                // searching "shrug" must beat "crying shrug"
                const nameStarts = e.n === t ? 3
                    : (e.n.startsWith(t) || e.n.includes(` ${t}`) ? 2 : 0);
                if (!inKw && !e.n.includes(t) && !e.cat.includes(t)) {
                    ok = false;
                    break;
                }
                score += nameStarts;
                score += inKw ? 1 : 0;
            }
            if (ok) scored.push([score, e]);
        }
        scored.sort((a, b) => b[0] - a[0] || a[1].n.localeCompare(b[1].n));
        return scored.map(([, e]) => e);
    }
}
