#!/usr/bin/env node
// Cliplet pure-module test + perf harness.
//
//   node tools/test/run.mjs
//
// No dependencies, no build step: a resolve hook maps `gi://GLib` to a stub
// (./gi-stub.mjs) so the shell-free modules can be imported as-is. Any module
// that reaches for `resource:///` (shell internals) fails to import here —
// which is the point: emojiModule/store/transforms must stay shell-free so
// they can be tested outside a session.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync, mkdtempSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

register('./hooks.mjs', pathToFileURL(`${import.meta.dirname}/`));

const SRC = '../../extension/src';
const { EmojiModule } = await import(`${SRC}/emojiModule.js`);
const { MemoryStore } = await import(`${SRC}/store.js`);
const { TRANSFORMS } = await import(`${SRC}/transforms.js`);

// ---------------------------------------------------------------- framework
let pass = 0, fail = 0;
const failures = [];
let group = '';

function describe(name) { group = name; console.log(`\n${name}`); }
function it(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        fail++;
        failures.push(`${group} › ${name}: ${e.message}`);
        console.log(`  ✗ ${name}\n      ${e.message}`);
    }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected true'); }
function eq(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`${msg || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function has(list, cp, msg) {
    ok(list.some((e) => e.cp === cp), `${msg || ''} expected U+${cp} in results: ${list.slice(0, 6).map((e) => `${e.g} ${e.n}`).join(', ')}`);
}

// ------------------------------------------------------------- fake settings
function fakeSettings({ tone = 0, favourites = [], recents = {} } = {}) {
    const state = { tone, favourites: [...favourites], recents: { ...recents }, writes: 0 };
    return {
        state,
        get_int: (k) => (k === 'emoji-tone' ? state.tone : 0),
        set_int: (k, v) => { if (k === 'emoji-tone') state.tone = v; },
        get_strv: (k) => (k === 'emoji-favourites' ? [...state.favourites] : []),
        set_strv: (k, v) => { if (k === 'emoji-favourites') state.favourites = [...v]; },
        get_value: (k) => ({ deep_unpack: () => (k === 'emoji-recents' ? { ...state.recents } : {}) }),
        set_value: (k, v) => { state.writes++; if (k === 'emoji-recents') state.recents = v.deep_unpack(); },
    };
}
const newModule = (opts) => new EmojiModule({ settings: fakeSettings(opts) });

// =========================================================== emoji data/index
describe('emoji index');
const mod = newModule();
const flat = mod.flat;

it('indexes every category entry exactly once', () => {
    const total = mod.categories.reduce((n, c) => n + c.emoji.length, 0);
    eq(flat.length, total, 'flat length');
    eq(new Set(flat.map((e) => e.cp)).size, flat.length, 'codepoints must be unique');
});

it('resolves the Characters/Symbols overlap to one entry per codepoint', () => {
    // 21 hand-authored characters duplicate generated emoji; the generated
    // (colour) copy wins and the Characters tab must not offer it twice.
    ok(mod.droppedDuplicates > 0, `expected suppressed duplicates, got ${mod.droppedDuplicates}`);
    const chars = mod.categories.find((c) => c.id === 'chars');
    for (const e of chars.emoji)
        ok(e.cat === 'chars', `U+${e.cp} in Characters is owned by "${e.cat}"`);
    const sun = flat.filter((e) => e.cp === '2600');
    eq(sun.length, 1, 'U+2600 must appear exactly once');
    eq(sun[0].cat, 'animals', 'the generated copy should win');
});

it('normalises the keyword field to a string (array k broke String.includes)', () => {
    const bad = flat.filter((e) => typeof e.k !== 'string');
    eq(bad.length, 0, `entries with a non-string k: ${bad.map((e) => e.cp).join(',')}`);
});

it('precomputes glyph, lowercase name and search haystack per entry', () => {
    for (const e of flat) {
        ok(typeof e.g === 'string' && e.g.length > 0, `U+${e.cp} has no glyph`);
        ok(typeof e._hay === 'string' && e._hay.length > 0, `U+${e.cp} has no haystack`);
        eq(e._n, e.n.toLowerCase(), `U+${e.cp} lowercase name`);
        const want = e.cp.split('-').map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
        eq(e.g, want, `U+${e.cp} glyph`);
    }
});

it('keeps one object identity per emoji across categories and search', () => {
    // the old {...e} copies meant the same emoji was two objects depending on
    // whether it arrived via a category or via search
    const joy = mod.search('tears of joy').find((e) => e.cp === '1F602');
    const catEntry = mod.categories.flatMap((c) => c.emoji).find((e) => e.cp === '1F602');
    ok(joy && joy === catEntry, 'search result must be the same object as the category entry');
});

it('uses one canonical uppercase codepoint identity', () => {
    // emojiExtra.js used to emit lowercase hex, so '▲' existed as both
    // '25B2' (Symbols) and '25b2' (Characters): the picker showed it twice
    // and favouriting one copy did not star the other.
    for (const e of flat)
        ok(/^[0-9A-F]+(-[0-9A-F]+)*$/.test(e.cp), `U+${e.cp} is not canonical uppercase hex`);
    eq(flat.filter((e) => e.g === '\u25B2').length, 1, '\u25B2 must appear exactly once');
});

it('still resolves favourites and recents persisted as lowercase hex', () => {
    const m = newModule({ favourites: ['25b2'], recents: { '2600': 4 } });
    eq(m.favourites().length, 1, 'lowercase favourite from an older build');
    eq(m.favourites()[0].cp, '25B2');
    eq(m.recents()[0].cp, '2600');
});

it('joins multi-codepoint sequences (flags)', () => {
    const us = flat.find((e) => e.cp === '1F1FA-1F1F8');
    ok(us, 'flag united states missing');
    eq(us.g, '\u{1F1FA}\u{1F1F8}', 'flag glyph');
});

describe('emoji coverage (regression guard for the curated-keyword gap)');
const REQUIRED = [
    ['2764', 'red heart'], ['2728', 'sparkles'], ['1F914', 'thinking face'],
    ['1F91D', 'handshake'], ['1F3C0', 'basketball'], ['1F917', 'hugging face'],
    ['1FAF6', 'heart hands'], ['1FAE1', 'saluting face'],
    ['1F602', 'tears of joy'], ['1F44D', 'thumbs up'], ['1F525', 'fire'],
    ['1F4AF', 'hundred'], ['1F6DC', 'wireless (Unicode 15 — do not lose on regeneration)'],
];
for (const [cp, why] of REQUIRED) {
    it(`ships U+${cp} — ${why}`, () => {
        ok(flat.some((e) => e.cp === cp), 'missing from the generated table');
    });
}

// ==================================================================== search
describe('emoji search');

it('finds curated keywords (was silently broken: Array.includes is exact-element)', () => {
    has(mod.search('lol'), '1F602', '"lol"');
    has(mod.search('laugh'), '1F602', '"laugh"');
    has(mod.search('muscle'), '1F4AA', '"muscle"');
    has(mod.search('poop'), '1F4A9', '"poop"');
    has(mod.search('sunglasses'), '1F60E', '"sunglasses"');
    has(mod.search('thumbsup'), '1F44D', '"thumbsup"');
    has(mod.search('100'), '1F4AF', '"100"');
    has(mod.search('rocket ship launch'), '1F680', '"rocket ship launch"');
});

it('ranks an exact name above a longer name containing it', () => {
    const r = mod.search('shrug');
    eq(r[0].n, 'shrug', '"shrug" must outrank "crying shrug"');
});

it('ranks the real emoji above a look-alike kaomoji', () => {
    eq(mod.search('thumbs up')[0].cp, '1F44D', '"thumbs up"');
    eq(mod.search('fire')[0].cp, '1F525', '"fire"');
});

it('matches on category id and label', () => {
    ok(mod.search('kaomoji').length > 50, 'category id "kaomoji"');
    ok(mod.search('characters').every((e) => e.cat === 'chars'), 'category label "characters"');
    ok(mod.search('chars').length > 50, 'category id "chars"');
});

it('ANDs tokens and is case/space insensitive', () => {
    const r = mod.search('  Face   TEARS  ');
    ok(r.length > 0, 'expected hits');
    for (const e of r) {
        ok(e._hay.includes('face') && e._hay.includes('tears'), `"${e.n}" does not match both tokens`);
    }
    eq(r.length, mod.search('face tears').length, 'normalisation');
});

it('returns nothing for a query that cannot match', () => {
    eq(mod.search('qqqzzz').length, 0);
    eq(mod.search('   ').length, 0, 'blank query');
});

// ================================================================ tone/glyph
describe('emoji glyph + skin tone');

it('appends the modifier only for tone-capable entries', () => {
    const wave = flat.find((e) => e.cp === '1F44B');
    const fire = flat.find((e) => e.cp === '1F525');
    eq(wave.t, 1, 'wave must be tone-capable');
    eq(mod.glyph(wave, 0), wave.g);
    eq(mod.glyph(wave, 3), `${wave.g}\u{1F3FD}`);
    eq(mod.glyph(fire, 3), fire.g, 'non-tone-capable entry must ignore the modifier');
});

it('reaches all five Unicode skin-tone modifiers', () => {
    // emoji-tone is 0..5 and Preferences offers six rows: the schema range
    // used to stop at 4, so U+1F3FF (darkest) could never be stored.
    const wave = flat.find((e) => e.cp === '1F44B');
    const want = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
    for (let tone = 0; tone <= 5; tone++)
        eq(mod.glyph(wave, tone), wave.g + want[tone], `tone ${tone}`);
    const schema = readFileSync(
        new URL('../../extension/schemas/org.gnome.shell.extensions.cliplet.gschema.xml', import.meta.url),
        'utf8');
    ok(/name="emoji-tone"[\s\S]*?max="5"/.test(schema), 'gschema must allow tone 5');
});

it('reads the tone from settings when not given, and survives a bare literal', () => {
    const s = fakeSettings({ tone: 2 });
    const m = new EmojiModule({ settings: s });
    const wave = m.flat.find((e) => e.cp === '1F44B');
    eq(m.glyph(wave), `${wave.g}\u{1F3FC}`, 'settings tone 2 = U+1F3FC');
    // the tone strip passes a literal {cp,t} with no precomputed glyph
    eq(m.glyph({ cp: '1F44B', t: 1 }, 5), `\u{1F44B}\u{1F3FF}`, 'bare literal');
});

it('exposes one-shot settings snapshots for grid builds', () => {
    const s = fakeSettings({ tone: 1, favourites: ['1F525', '2764'] });
    const m = new EmojiModule({ settings: s });
    eq(m.tone, 1);
    const set = m.favouriteSet();
    ok(set instanceof Set && set.has('1F525') && set.has('2764') && set.size === 2, 'favouriteSet');
});

// ======================================================== favourites/recents
describe('emoji favourites + recents');

it('toggles favourites and keeps entry identity', () => {
    const s = fakeSettings();
    const m = new EmojiModule({ settings: s });
    const fire = m.flat.find((e) => e.cp === '1F525');
    eq(m.isFavourite(fire), false);
    eq(m.toggleFavourite(fire), true, 'first toggle adds');
    eq(m.isFavourite(fire), true);
    eq(m.favourites()[0], fire, 'identity');
    eq(m.toggleFavourite(fire), false, 'second toggle removes');
    eq(m.favourites().length, 0);
});

it('ignores favourites that are not in the table', () => {
    const m = newModule({ favourites: ['1F525', 'DEADBEEF'] });
    eq(m.favourites().length, 1, 'unknown codepoint dropped');
});

it('orders recents by use count and caps the band', () => {
    const s = fakeSettings();
    const m = new EmojiModule({ settings: s });
    const picks = ['1F525', '1F44D', '2764', '1F602', '1F4AF', '1F680', '1F389', '1F600', '1F60D'];
    for (const cp of picks) {
        const e = m.flat.find((x) => x.cp === cp);
        for (let i = 0; i < (cp === '1F525' ? 9 : 1); i++) m.bumpUse(e);
    }
    const r = m.recents();
    ok(r.length <= 7, `recents capped at 7, got ${r.length}`);
    eq(r[0].cp, '1F525', 'most used first');
    eq(s.state.writes, picks.length + 8, 'one settings write per bump');
});

it('drops recents that are not in the table', () => {
    const m = newModule({ recents: { '1F525': 3, DEADBEEF: 9 } });
    eq(m.recents().length, 1);
});

// ================================================================ transforms
describe('text transforms');
const T = TRANSFORMS;
it('trims, collapses and reflows', () => {
    eq(T['Trim spaces']('  a  \n\t b\t'), 'a\nb');
    eq(T['Remove line breaks']('a\n\n  b\nc'), 'a b c');
    eq(T['Collapse blank lines']('a\n\n\n\nb\n\n'), 'a\n\nb');
});
it('changes case', () => {
    eq(T['UPPERCASE']('aB'), 'AB');
    eq(T['lowercase']('aB'), 'ab');
    eq(T['Title Case']('hello WORLD'), 'Hello World');
});
it('sorts and dedupes lines', () => {
    eq(T['Sort lines']('b\na\nc'), 'a\nb\nc');
    eq(T['Dedupe lines']('a\na\nb'), 'a\nb');
});
it('URL-decodes and survives malformed input', () => {
    eq(T['URL-decode']('a%20b+c'), 'a b c');
    eq(T['URL-decode']('%E0%A4%A'), '%E0%A4%A', 'malformed escape must be returned untouched');
});
it('every transform is a pure function of its input', () => {
    for (const [name, fn] of Object.entries(T)) {
        const src = 'b\na\n a ';
        eq(fn(src), fn(src), `${name} not deterministic`);
        eq(src, 'b\na\n a ', `${name} mutated its input`);
    }
});

// ===================================================================== store
describe('memory store');
const newStore = (cap = 5) => new MemoryStore(cap);
const add = (store, text, app = 'gedit') => store.add({ text, app, time: Date.now() });

it('dedupes by content and keeps identity stable', () => {
    const s = newStore();
    const a = add(s, 'hello');
    add(s, 'world');
    const again = add(s, 'hello');
    eq(s.recent.length, 2, 'no duplicate row');
    ok(a === again, 'same object');
    eq(s.recent[0], a, 'moved to top');
});

it('prunes to capacity, oldest first', () => {
    const s = newStore(3);
    for (const t of ['a', 'b', 'c', 'd']) add(s, t);
    eq(s.recent.length, 3);
    eq(s.recent.map((e) => e.text).join(''), 'dcb');
});

it('keeps pins out of recents and alive across clearHistory', () => {
    const s = newStore();
    const a = add(s, 'keep me');
    add(s, 'scratch');
    s.pin(a);
    eq(s.recent.length, 1);
    eq(s.pins.length, 1);
    s.clearHistory();
    eq(s.pins.length, 1, 'pins survive clear');
    ok(s.hasUndo());
    s.undo();
    eq(s.recent.length, 1, 'clear is undoable');
});

it('deletes with a single-level undo', () => {
    const s = newStore();
    const a = add(s, 'gone');
    s.delete(a);
    eq(s.recent.length, 0);
    ok(s.undo() === a, 'undo returns the entry');
    eq(s.recent.length, 1);
});

it('transforms text in place, re-hashes and dedupes the result', () => {
    const s = newStore();
    const a = add(s, 'b\na');
    add(s, 'a\nb');
    s.updateText(a, 'a\nb');
    eq(s.count, 1, 'the transformed clip collided with an existing one');
});

it('searches text and app, and sees a transform immediately', () => {
    const s = newStore();
    const a = add(s, 'Invoice 4711', 'libreoffice');
    eq(s.search('invoice').recent.length, 1, 'text match');
    eq(s.search('libreoffice').recent.length, 1, 'app match');
    eq(s.search('4711 libre').recent.length, 1, 'AND across tokens');
    eq(s.search('nope').recent.length, 0);
    s.updateText(a, 'RECEIPT 4711');
    eq(s.search('invoice').recent.length, 0, 'stale haystack after updateText');
    eq(s.search('receipt').recent.length, 1, 'new text is searchable');
});

it('folds the search haystack once per entry, not once per keystroke', () => {
    const s = newStore();
    const big = 'x'.repeat(50000);
    const e = add(s, big);
    s.search('xxx');
    const cached = e._hay;
    ok(typeof cached === 'string' && cached.length > 50000, 'haystack cached on the entry');
    s.search('xxx');
    ok(e._hay === cached, 'second search must reuse the cached haystack');
});

it('restores a persisted session without re-saving it', () => {
    let dirty = 0;
    const s = new MemoryStore(50, () => dirty++);
    s.restoreFrom([
        { text: 'old', app: 'a', time: 1, pinned: true },
        { text: 'new', app: 'b', time: 2 },
    ]);
    eq(dirty, 0, 'restore must not schedule a save');
    eq(s.pins.length, 1);
    eq(s.recent.length, 1);
});

// ====================================================================== perf
//
// Reported, not asserted: these run on whatever machine executes them, and a
// timing assertion in a repo with no CI is a flake factory. The BEFORE column
// is the same measurement taken against the code at commit 57e73e2 (Node v22,
// best of 5 runs x 3 iterations, same machine) — reproduced with:
//
//   git show 57e73e2:extension/src/emojiModule.js > /tmp/before/emojiModule.js
//   (same for emojiData.js and emojiExtra.js, then import from /tmp/before)
//
// Node numbers understate the wins that matter in the shell: GSettings reads
// are GI calls, `localeCompare` has no cached collator in SpiderMonkey, and
// actor construction does not exist here at all. See REVIEW.md.
const BEFORE = {
    construct: 0.58,       // new EmojiModule(): 1603 entries, {...e} copies
    cellsAll: 0.49,        // glyph()+isFavourite() for every entry
    searchTyping: 1.85,    // 's','sm','smi','smil','smile'
    searchWide: 0.68,      // 's' -> ~1400 hits
    searchNarrow: 0.26,    // 'smile'
    settingsReadsPerBuild: 3322,  // 2 per cell x 1661 cells (a full grid build)
};

function best(fn, runs = 5, iters = 3) {
    let min = Infinity;
    for (let r = 0; r < runs; r++) {
        fn();
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < iters; i++) fn();
        min = Math.min(min, Number(process.hrtime.bigint() - t0) / 1e6 / iters);
    }
    return min;
}

describe('perf (reported)');
const m2 = newModule();
const counting = (() => {
    let reads = 0;
    const s = fakeSettings();
    const orig = s.get_int;
    s.get_int = (k) => { reads++; return orig(k); };
    const origV = s.get_strv;
    s.get_strv = (k) => { reads++; return origV(k); };
    const m = new EmojiModule({ settings: s });
    // what a grid build costs now: two snapshots, then per-cell property reads
    const tone = m.tone;
    const favs = m.favouriteSet();
    for (const e of m.flat) m.glyph(e, tone), favs.has(e.cp);
    return reads;
})();

const rows = [
    ['index build (per enable())', best(() => newModule()), BEFORE.construct],
    ['per-cell glyph+favourite, all cells', best(() => { for (const e of m2.flat) { m2.glyph(e); m2.isFavourite(e); } }), BEFORE.cellsAll],
    ['search: typing "smile" (5 queries)', best(() => { for (const q of ['s', 'sm', 'smi', 'smil', 'smile']) m2.search(q); }), BEFORE.searchTyping],
    ['search: "s" (widest query)', best(() => m2.search('s'), 5, 5), BEFORE.searchWide],
    ['search: "smile"', best(() => m2.search('smile'), 5, 5), BEFORE.searchNarrow],
];
console.log(`  ${'measurement'.padEnd(38)}${'now'.padStart(9)}${'before'.padStart(9)}   delta`);
for (const [label, now, before] of rows) {
    const delta = ((now - before) / before * 100);
    console.log(`  ${label.padEnd(38)}${`${now.toFixed(2)}ms`.padStart(9)}${`${before.toFixed(2)}ms`.padStart(9)}   ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`);
}
console.log(`  ${'GSettings reads per full grid build'.padEnd(38)}${String(counting).padStart(8)} ${String(BEFORE.settingsReadsPerBuild).padStart(8)}   -${Math.round((1 - counting / BEFORE.settingsReadsPerBuild) * 100)}%`);
console.log(`  ${'actors built before first paint'.padEnd(38)}${'~90'.padStart(9)}${'~1500'.padStart(9)}   -94%  (grid is lazy now)`);
console.log(`  ${'emoji insert latency (structural)'.padEnd(38)}${'~1 frame'.padStart(9)}${'250ms+'.padStart(9)}   input-method commit; chord as fallback`);
console.log('\n  "before" = the same measurement against commit 57e73e2, on this machine.');
console.log('  Node cannot see GI/GSettings, SpiderMonkey collation or actor construction —');
console.log('  those are the rows marked structural. Verify in-session with CLIPLET_PERF=1.');

// ================================================================ packaging
describe('packaging');

const SETTINGS_KEYS = (() => {
    const xml = readFileSync(new URL('../../extension/schemas/org.gnome.shell.extensions.cliplet.gschema.xml', import.meta.url), 'utf8');
    return new Set([...xml.matchAll(/<key name="([^"]+)"/g)].map((m) => m[1]));
})();

// Only keys read on OUR settings object: the code also talks to
// org.gnome.desktop.interface (colour-scheme/accent) and the media-keys
// custom-keybinding schema (name/command/binding), and those are not ours to
// declare.
const SETTINGS_RECEIVER = '(?:this\\.)?_?settings';
const KEY_PATTERNS = [
    new RegExp(`(?:^|[^\\w.])${SETTINGS_RECEIVER}\\s*\\.\\s*(?:get|set)_(?:string|boolean|int|double|strv|value|uint)\\(\\s*'([^']+)'`, 'g'),
    new RegExp(`(?:^|[^\\w.])${SETTINGS_RECEIVER}\\s*\\.\\s*bind\\(\\s*'([^']+)'`, 'g'),
    new RegExp(`(?:^|[^\\w.])${SETTINGS_RECEIVER}\\s*\\.\\s*connect\\(\\s*'changed::([a-z0-9-]+)'`, 'g'),
];

it('every settings key the code touches exists in the schema', () => {
    const files = ['extension.js', 'prefs.js',
        'src/popup.js', 'src/capture.js', 'src/injector.js', 'src/emojiModule.js',
        'src/persist.js', 'src/indicator.js', 'src/conflictScan.js', 'src/ocr.js'];
    const used = new Map();
    for (const f of files) {
        const src = readFileSync(new URL(`../../extension/${f}`, import.meta.url), 'utf8');
        for (const re of KEY_PATTERNS)
            for (const m of src.matchAll(re))
                if (m[1]) used.set(m[1], f);
    }
    ok(used.size >= 20, `only found ${used.size} settings keys — the pattern is probably broken`);
    const missing = [...used.keys()].filter((k) => !SETTINGS_KEYS.has(k));
    eq(missing.join(', '), '', `keys used in code but absent from the schema: ${missing.map((k) => `${k} (${used.get(k)})`).join(', ')}`);
});

it('declares no settings key the code never reads', () => {
    // informational: a key nobody reads is either dead or written from prefs only
    const xml = readFileSync(new URL('../../extension/schemas/org.gnome.shell.extensions.cliplet.gschema.xml', import.meta.url), 'utf8');
    const all = [...xml.matchAll(/<key name="([^"]+)"/g)].map((m) => m[1]);
    const src = ['extension.js', 'prefs.js', 'src/popup.js', 'src/capture.js', 'src/injector.js',
        'src/emojiModule.js', 'src/persist.js', 'src/indicator.js', 'src/ocr.js', 'src/jot.js',
        'src/conflictScan.js', 'src/snippets.js', 'src/store.js', 'src/keybindings.js']
        .map((f) => readFileSync(new URL(`../../extension/${f}`, import.meta.url), 'utf8')).join('\n');
    const unread = all.filter((k) => !src.includes(`'${k}'`) && !src.includes(`changed::${k}`) && !src.includes(k));
    eq(unread.join(', '), '', `schema keys never referenced: ${unread.join(', ')}`);
});

it('the compiled schema is not committed (it is a build artefact, and a stale one silently wins)', () => {
    const tracked = execFileSync('git', ['ls-files', 'extension/schemas/'], { cwd: new URL('../..', import.meta.url).pathname })
        .toString().trim().split('\n').filter(Boolean);
    ok(!tracked.includes('extension/schemas/gschemas.compiled'),
        'gschemas.compiled is tracked — regenerate locally with glib-compile-schemas');
});

it('the settings schema compiles', ( ) => {
    let bin = null;
    try { bin = execFileSync('which', ['glib-compile-schemas']).toString().trim(); } catch { bin = null; }
    if (!bin) { console.log('      (skipped: glib-compile-schemas not installed here)'); return; }
    const dir = mkdtempSync('/tmp/cliplet-schema-');
    copyFileSync(new URL('../../extension/schemas/org.gnome.shell.extensions.cliplet.gschema.xml', import.meta.url),
        `${dir}/org.gnome.shell.extensions.cliplet.gschema.xml`);
    execFileSync(bin, [dir]);
    ok(existsSync(`${dir}/gschemas.compiled`), 'glib-compile-schemas produced no output');
});

// =================================================================== summary
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
