# Cliplet — senior developer review

**Reviewer scope:** every line of `extension/` (≈7.0k lines of GJS across 15 modules),
the build pipeline in `tools/`, the schema, the stylesheet and the README.
**Branch:** `arena/6a6ff61b-cliplet` (from `57e73e2`).
**Complaint being chased:** *"emoji is slow, adds on slowly — not like Windows or macOS."*

**How I worked.** No GNOME session exists in this sandbox, so I split the review in two:

1. **Measured.** The shell-free modules (`emojiModule`, `store`, `transforms`) import
   cleanly under plain Node once `gi://GLib` is stubbed. That harness is now
   `tools/test/run.mjs` (52 assertions + a perf report, zero dependencies,
   `node tools/test/run.mjs`). Every "measured" number below comes from it, on the
   same machine, old code vs new code, median/best of interleaved runs.
2. **Structural.** Anything involving Clutter actors, GSettings/GI marshalling,
   Mutter focus or SpiderMonkey cannot be measured outside a session. Those findings
   are reasoned from the code and from how GNOME itself solves the same problem
   (I read `gnome-shell@gnome-50`'s `js/ui/keyboard.js` and `js/misc/inputMethod.js`
   for this), and they are labelled **structural**. I also added an opt-in probe
   (`CLIPLET_PERF=1`) so you can confirm them on your machine in one sitting.

---

## Verdict

The architecture is better than most shell extensions I read: the `enable()`/`disable()`
symmetry is treated as a checklist, the privacy model is real (MIME inspection before
content reads, hint-based secret suppression, opt-in persistence that deletes its own
residue), and the injection guard — *refuse to type rather than type into the wrong
window* — is the correct instinct and correctly placed (late, at inject time).

But the emoji path had **four independent defects** that add up exactly to the complaint,
and reading for those turned up **nine more correctness bugs** elsewhere. None were
stylistic; each is a user-visible failure. The four headline ones:

| # | Defect | User-visible symptom |
|---|---|---|
| 1 | Only delivery mechanism was *clipboard + injected `Ctrl+V`*, which waits a **fixed 250 ms** after the modal releases before the first attempt (and up to 600 ms more if a modifier is held) | "the emoji takes a moment to appear" — Windows/macOS are one frame |
| 2 | The grid materialised **every** match as actors before the first paint: `"s"` → 1,416 hits → 142 rows → ~2,900 GObjects, ~90 of them ever visible | first keystroke hangs; typing feels laggy |
| 3 | **Two GSettings reads per cell** (`emoji-tone`, `emoji-favourites`) → 3,322 GI calls for a wide grid build | every category switch / keystroke pays it |
| 3b | …and the grid **cache ignored the tone**, so a tone change never reached the glyphs it had already built | picker shows 👋, inserts 👋🏽 |
| 4 | Keyword search was **silently dead** (`Array.prototype.includes` on a 43-entry array of keyword strings) | `lol` → 🍭 only; you retype, scroll, give up |

All four are fixed on this branch. Defect 1 is the one that answers the complaint directly.

---

## 1. Why emoji insertion felt slow

### The latency budget, before this branch

`popup._activateCell()` → `close(cb)` → `injector.paste()`:

| Stage | Code | Cost |
|---|---|---|
| `bumpUse()` + glyph + one settings read | `popup.js` `_activateCell` | ~0.2 ms |
| close: instant hide, `popModal`, key-focus release | `popup.js` `_maybeFinishClose` | ~1 frame |
| **held-modifier wait** (only if a modifier is down) | `MODIFIER_RELEASE_CAP_MS = 600` | 0–600 ms |
| clipboard write | `_setClipboard` | ~0.5 ms |
| **fixed focus grace before the *first* inject attempt** | `FOCUS_RETRIES_MS[0] = 250` | **250 ms, always** |
| inject `Ctrl+V` (4 × `notify_keyval`) | `_inject` | ~0.1 ms |
| Wayland round trip + client-side clipboard fetch + insert | — | 5–30 ms (more for large clips) |

So the floor was **~250 ms**, the realistic case **250–350 ms**, and holding `Super`
after `Super+.` pushed it toward 850 ms. On top of that, **every emoji insert destroyed
the user's clipboard** — the opposite of Windows and macOS, which never touch it.

The 250 ms is not sloppiness; it is load-bearing. `paste()` runs immediately after
`popModal`, and on Wayland the client has not necessarily re-received
`wl_keyboard.enter` yet — inject too early and the chord lands nowhere. The comment says
as much. The problem is that Cliplet only had the one mechanism, so it had to pay the
grace unconditionally.

### How GNOME does it (the reference I checked)

`gnome-shell@gnome-50`, `js/ui/keyboard.js:2099` — the shell's own emoji picker:

```js
Main.inputMethod.commit(str);
```

`Main.inputMethod` is a `Clutter.InputMethod` (`js/misc/inputMethod.js`); `commit()`
hands the string straight to the focused client's text-input context (text-input-v3 or
IBus). No clipboard, no chord, no grace period — one frame. It falls back to virtual
keyvals only when there is no IM focus (its comment: *"If there is no IM focus (e.g. with
X11 clients) … send raw key events"*), and keyvals cannot represent emoji at all
(`_getKeyvalsFromString` returns `[]` for a codepoint that is not in the keymap).

### The fix (`extension/src/injector.js`)

```
paste()
 ├─ text + Main.inputMethod.commit exists  →  _commitViaInputMethod()
 │      poll one frame at a time, ≤180 ms, for:
 │        • im.currentFocus            (a text-input client is focused)
 │        • !global.stage.key_focus    (a shell actor — e.g. our own search
 │                                      entry — does not hold the keys)
 │        • focusMatches(recorded)     (the same window the popup opened over)
 │      → im.commit(glyph)             ≈ 1–3 frames, clipboard untouched
 │      → budget expires → _pasteViaChord()   (unchanged legacy path)
 └─ images / no IM                      →  _pasteViaChord()
```

The chord path is byte-for-byte the old behaviour, so apps with no text-input support
(X11 clients, Wayland apps without text-input-v3/IBus) are exactly as they were. The
guard order matters: committing while our own `St.Entry` still owns IM focus would type
the glyph into the hidden search box — hence the `key_focus` test.

**Expected result:** insert latency drops from ~250–350 ms to ~16–50 ms in GTK4/Qt/IBus
apps, and the clipboard survives. **Structural — please verify** (§5).

**Two deliberate behaviour changes**, both matching Windows/macOS:

- the glyph is no longer left on the clipboard after an insert (so `Ctrl+V` does not
  repeat it);
- the insert no longer needs the "internal set" suppression, because nothing is written.

**Rollback is one line** if the IM path misbehaves in your session: make
`_commitViaInputMethod()` `return false` immediately.

### The grid (`extension/src/popup.js`)

Even with instant delivery, the picker itself was expensive to open and to type in.
`_refreshEmoji()` built every match as `St.Button` + `St.Label` + a row `St.BoxLayout`
before the panel could paint:

| query | hits | rows | GObjects built before first paint |
|---|---|---|---|
| `"s"` | 1,416 | 142 | ~2,900 |
| `"sm"` | 223 | 23 | ~470 |
| category *Objects* | 342 | 35 | ~720 |

Only ~8 rows (≈90 cells) are ever visible in a 442 px body. Windows, macOS and GNOME's
own pager all render a viewport — `js/ui/keyboard.js` builds exactly `nCols × nRows`
keys per page, and generates a page only when it becomes current (`_generatePanel`).

Cliplet now does the same, in the least invasive form that keeps the existing cache and
keyboard model:

- `_mountGrid()` builds **9 rows synchronously** (one viewport), then appends **12-row
  slices on `GLib.idle_add(PRIORITY_DEFAULT_IDLE)`** until complete;
- `_ensureGridRows()` builds forward on demand for keyboard navigation, selection and
  scrolling, so nothing is ever reachable-but-missing;
- `_gridEntries` stays complete, so counts, the section header and `←→` category
  stepping are unchanged;
- completed builds are cached **per (mode, tone, query)**, and the cache is now bounded
  by **cells (2,400)**, not by entry count. The old cap of 12 entries could pin
  ~16,000 live button actors, because one cached single-letter search holds ~1,400 of
  them;
- partial builds are never cached and are torn down when superseded.

**Structural:** ~2,900 → ~190 GObjects before first paint for a wide search (≈15×).
`emoji.refresh` is instrumented, so you can read the real number (§5).

### Per-cell settings traffic (measured)

`_makeCell()` called `glyph(entry)` (→ `get_int('emoji-tone')`) and `isFavourite(entry)`
(→ `get_strv('emoji-favourites')`, a fresh array allocation) **per cell**.

| | before | after |
|---|---|---|
| GSettings reads per full grid build | 3,322 | **2** |
| per-cell glyph + favourite work, 1,603 cells (Node) | 0.46 ms | **0.012 ms** (−97%) |

In Node that is half a millisecond. In gjs each of those is a GI call crossing into
GSettings, and `get_strv` allocates a JS array every time — the real-shell delta is
larger and is the reason this is labelled **structural** even though the mechanism is
measured. `EmojiModule` now exposes `tone` and `favouriteSet()` snapshots; the popup
takes them once per build.

### Search (measured, plus a correctness fix)

```js
const inKw = e.k.includes(t);            // e.k was an ARRAY for 43 entries
```

`Array.prototype.includes` is an **exact-element** test, so for
`k: ['lol laugh cry tears joy']` the token `lol` never matched. The generator emitted
Python lists (`kw = KEYWORDS.get(cp, "")` rendered with `!r`) for exactly the 43 entries
that carry curated keywords — i.e. **every curated keyword in the product was dead**,
and they are the highest-value ones:

| query | before | after |
|---|---|---|
| `lol` | 🍭 lollipop only | 😂 + 🍭 |
| `muscle` | no 💪 | 💪 |
| `tears of joy` | 😹 ranked first | 😂 ranked first |
| `thumbs up` | kaomoji `d(-_^)` first | 👍 first |

Fixed at both ends: `tools/gen_emoji_data.py` now joins keywords to a string, and
`EmojiModule` normalises defensively at index time (so an already-generated table still
works). Also removed: a `hay` string built per entry per query but never read, and
`localeCompare` as the sort tie-breaker (in SpiderMonkey, unlike V8, there is no cached
`Intl.Collator`; measured ≈0 difference in V8, so this is free insurance rather than a
claim).

Measured, **same 1,603-entry dataset both sides** so only the code differs (Node v22,
median of 9 interleaved runs):

| | before | after | |
|---|---|---|---|
| `search("smile")` | 0.249 ms | 0.112 ms | −55% |
| typing `s,sm,smi,smil,smile` | 1.884 ms | 1.294 ms | −31% |
| `search("s")` (widest) | 0.736 ms | 0.690 ms | −6% |
| `new EmojiModule()` | 0.300 ms | 0.652 ms | **+117%** |

The construction regression is deliberate and tiny: glyph, lowercase name and search
haystack are now computed **once per enable()** instead of per keystroke / per cell.
Sub-millisecond either way.

---

## 2. Correctness bugs found while reading (all fixed)

These are not perf, but several of them read as "the emoji picker is broken/slow":

1. **Arrow keys and `Enter` die after clicking a favourite or recent.**
   `_makeCell(fixed:true)` leaves `clipletIndex` undefined; the click handler then called
   `_selectEmoji(undefined)` → `_emojiSel = undefined` → the next clamp
   `Math.max(0, Math.min(n-1, undefined))` → **`NaN`**. `NaN !== NaN`, so `_moveEmoji`
   "moved" forever without changing anything, and `Enter` inserted `_gridEntries[NaN]`
   = nothing. Recovered only by clicking a category. Reproduced arithmetically; fixed at
   four points (don't select for fixed cells, finite-check the clamp, bail in
   `_moveEmoji`, coerce in `_selectEmoji`).

2. **Right-click "favourite" never repainted its star.** `_toggleFavourite` iterated
   `this._grid.get_children()` — those are **rows**, not cells, so
   `child.clipletEntry` was always undefined. Fixed by `_syncStars()`, which walks the
   mounted grid, the cached (detached) grids and both bands.

3. **Two identities for one character.** `emojiExtra.js` built `cp` with
   `toString(16)` → **lowercase** (`'25b2'`); the generator emits **uppercase**
   (`'25B2'`). So `▲ △ ▼ ◆ ● ○ ◐ ◉ …` existed twice: shown twice in the picker
   (once as colour emoji in Symbols, once as a text glyph in Characters), and
   favouriting one did not star the other. Folded to uppercase at index time, with
   `_lookup()` still resolving values persisted in lowercase.

4. **21 duplicate codepoints** across the generated and hand-authored tables
   (`↔ ✔ ☀ ☁ ☂ ☃ ☄ ☠ ⚙ ✂ ✉ ▲ △ ▼ ▽ ◆ ◇ ● ○ ◉ ◐`). First occurrence now wins
   (the generated colour emoji), `Characters` drops from 134 to 113 entries, and
   `_byCp` no longer resolves recents/favourites to whichever copy was built last.

5. **The darkest skin tone was unreachable.** The schema capped `emoji-tone` at 4, but
   there are five Unicode modifiers (`U+1F3FB..U+1F3FF`) and `prefs.js` offers six rows
   — its own comment admitted *"selected maps 0..5; setting is 0..4"*. Choosing **Dark**
   in Preferences wrote an out-of-range value: a GSettings critical and no effect. The
   in-popup tone strip and the `T` popover also stopped at 4, so they only ever offered
   four tones. Schema range is now 0..5, both pickers build 6, and the chips are 22 px
   with 3 px spacing so six still fit the 520 px panel beside the 11-button rail.

6. **8 of the top-53 most-used emoji were missing entirely** — `❤ ✨ 🤔 🤝 🏀 🤗 🫶 🫡`.
   Five of them had curated keywords in the generator, i.e. dead config pointing at
   emoji the range rules never admitted. Anyone comparing against Windows notices `❤`
   and `✨` missing in the first ten seconds. Range rules extended (faces
   `1F910–1F917`, `1FAE0–1FAE8`; hands `1F918–1F91F`, `1FAF0–1FAF8`; instruments/balls
   `1F3B0–1F3C0`, `1F3C2–1F3C9`; `2728`, `2764`). Dataset: 1,380 → 1,438 generated
   entries, 1,640 unique picker entries after dedupe. **Note:** `U+1F6DC` (wireless,
   Unicode 15) survives only in the committed table — this sandbox has Python 3.11
   (Unicode 14), so regenerating here would silently drop it. There is a test that
   fails if it does.

7. **`Super+V` could fail silently** — directly contradicting the README's *"never a
   silent takeover"* promise. `_grabSeq` was a single counter shared by both shortcuts,
   so `_grabShortcut('emoji')`, called immediately after `_grabShortcut('clipboard')` in
   `enable()`, invalidated the clipboard retry token. The 300/900/2000 ms retry ladder
   aborted **before** `_reportGrab`, so a held `Super+V` produced no notification, no
   takeover offer, nothing. The token is now per-id.

8. **Double paste on rapid inserts.** `paste()` overwrote `_pendingId` without removing
   the previous `GLib` source, so two inserts inside the focus-grace window injected two
   chords — the second pasting whatever the first had left on the clipboard. Now
   `_cancelPending()` runs first (and in `disable()`).

9. **Two main-thread I/O costs per keystroke in clipboard mode:**
   `MemoryStore.search()` lowercased *every* clip on *every* keystroke (with the default
   100 KiB cap and 200 entries that is up to ~20 MB of allocation per keypress), and
   `Snippets.search()` re-read and re-parsed `snippets.json` from disk per keystroke
   (`GLib.file_get_contents`, synchronous, in the shell's main loop) — twice, because
   `search()` called `_load()` and then `list()`, which called it again. The haystack is
   now cached on the entry (invalidated wherever text/app change) and the file reload is
   mtime-guarded.

10. **The skin-tone picker was a visual no-op on any cached grid.** The grid cache key
    was `cat:<id>` / `q:<query>` with no tone component and no invalidation anywhere in
    the file. Pick a tone and `_refreshEmoji()` hit the cache, so the strip's selected
    border moved while every glyph stayed at the old tone — and because insertion
    re-derived the glyph from settings, the picker *showed* 👋 and *inserted* 👋🏽.
    The tone is now part of the cache key, and `_syncStars()` reaches into cached
    (detached) grids so a favourite toggle survives a cache hit too.

Also removed: dead `FOCUS_DELAY_MS`, dead `_onActivate` in `KeybindingManager`, and the
unused `hay` in `EmojiModule.search()`.

---

## 3. Repo hygiene

- **`extension/schemas/gschemas.compiled` was committed** — a build artefact, and a
  dangerous one: GNOME Shell loads the schema from the extension's `schemas/` directory
  and never compiles it, so a stale binary silently overrides the XML. After the
  `emoji-tone` range fix it *would* have undone the fix for anyone who skipped
  `glib-compile-schemas`. Now untracked and gitignored, with the README step unchanged
  (and mandatory). There is a test asserting it stays untracked, and one that compiles
  the XML when `glib-compile-schemas` is available.
- **No tests at all** for ~7k lines, despite three modules that are explicitly
  shell-free *and documented as "trivially testable"* (`transforms.js` says so itself).
  `tools/test/run.mjs` now covers the emoji index, search ranking and recall, tone
  modifiers, favourites/recents, all nine transforms, the store (dedupe, prune, pins,
  undo, transform re-hash, search invalidation) and packaging invariants (every settings
  key used in code exists in the schema; no schema key is unread). 52 assertions, no
  dependencies, runs in ~0.5 s. **Add a GitHub Action for it** — ten lines.
- `metadata.json`: `"url": ""` (e.g.o rejects an empty URL) and `uuid` is
  `cliplet@review.local`. Both must change before publishing.
- No `eslint` config, though the code clearly follows the GNOME Shell style (4-space,
  `gjs` conventions). Worth adding `eslint-plugin-jsdoc`-free GNOME settings so style
  drift is caught mechanically.
- No i18n: every user-facing string is inline. Fine for a review build, a blocker for
  e.g.o's "localized" tick.

---

## 4. Not fixed — recommended, in priority order

Each of these is a deliberate scope decision, not an oversight. Effort is my estimate.

| # | Item | Why | Effort |
|---|---|---|---|
| 1 | **Non-modal emoji mode.** The popup holds a `pushModal` grab, so the target window has no keyboard/IM focus while it is open — which is exactly why the IM commit must wait for `close()`. Windows keeps its picker open and inserts repeatedly; that needs the emoji mode to be a non-modal, focus-preserving surface (or an OSK-style actor). | True Windows parity: click, click, click, then dismiss. Also removes the remaining frame of latency. | M — grab/focus redesign, needs on-device iteration |
| 2 | **Make the chord ladder event-driven.** For apps with no IM focus the 250 ms constant is still the floor. Listen for `display::notify::focus-window` and inject on the next frame after focus returns, keeping 250/550/850 as a ceiling rather than a fixed first delay. | Removes the constant for the fallback path too. | S — but **measure first** with `CLIPLET_PERF=1`; the constant was presumably tuned empirically and I refuse to shorten it blind |
| 3 | **Real grid virtualization.** The lazy build still materialises everything if you scroll to the bottom, and the cache keeps it alive. A recycling viewport (fixed content height from `entries.length`, ~90 pooled cell actors re-keyed on scroll) is what GNOME's pager and every OS picker do. | Constant memory and constant build cost regardless of hit count. | M |
| 4 | **Recents are ordered by use *count*, not recency.** The file header cites the spec (`§09 #16`), so this is intentional — but it means the band never changes once you have a few favourites, which is not what "Recent" means on Windows or macOS, and it is the second thing a comparer notices. Hybrid score (count × recency decay) or a `last-used` timestamp; needs a schema change (`a{si}` → something with a timestamp) and a migration. | Product/UX. | S–M (schema + migration) |
| 5 | **`font-family: 'Noto Color Emoji'` is hardcoded** on `.cliplet-grid-cell`, `.cliplet-rail-glyph`, `.cliplet-tone-chip` and `.cliplet-tone-swatch`. If that font is absent (it is not installed by default everywhere), every cell falls back through fontconfig per glyph — slow, and possibly monochrome or boxed. The README even says the extension "renders through the user's system emoji font", which the CSS contradicts. | Robustness + first-paint cost. Drop the family and let Pango do emoji fallback, or list fallbacks. | S |
| 6 | **`transition-duration` on all 1,600 grid cells.** Every hover and every selection ring starts a CSS transition on an actor whose style is also being changed inline. | Scope transitions to the properties that need them, or drop them in the grid. | S |
| 7 | **Selection ring via `set_style("border: 2px solid …")`.** An inline style string forces a full CSS re-resolution for that actor on every arrow key, and re-parses the string. Use a `cliplet-cell-selected` style class and set the accent once on the panel. | Cheaper, and themeable. | S |
| 8 | **`get_preferred_height(-1)` on four actors per refresh** (rail, fav section, recents plate, grid section) — synchronous layout requests, per keystroke, to pin the scroll height. Those heights only change with the compact setting and the bands' visibility; cache them. | Small, free. | S |
| 9 | **The held-modifier wait also delays IM inserts** (`MODIFIER_RELEASE_CAP_MS = 600` in `_maybeFinishClose`). It exists to stop `Super` polluting an injected chord; an IM commit has no chord to pollute. Skip the wait when delivery will be IM. | Up to 600 ms in the `Super+.` → `Enter` flow. | S |
| 10 | **`popup.js` is 2,4xx lines doing six jobs** (layout, clipboard list, emoji grid, menus, drag, event routing). Every bug in §2 lived in it. Split the emoji grid and the clipboard list into their own modules. | Maintainability. | M |
| 11 | **Store search cache doubles worst-case memory** (the folded haystack sits next to the text). Consider indexing only the first N KiB of each clip — Windows' history search matches the preview, not the whole blob. | Memory bound. | S |
| 12 | **Tone modifier placement is append-at-end.** Correct for all 88 tone-capable entries today (none are multi-codepoint — verified), but a ZWJ sequence (`👨‍💻`) would get the modifier after the laptop instead of after the person. Assert the invariant in the generator so the data can never break it silently. | Latent landmine. | S |

---

## 5. How to verify this on your machine

**Tests** (no session needed):

```sh
node tools/test/run.mjs
```

**Install** — the schema compile step is now mandatory, because the compiled artefact is
no longer committed and `emoji-tone`'s range changed:

```sh
ln -s "$PWD/extension" ~/.local/share/gnome-shell/extensions/cliplet@review.local
glib-compile-schemas extension/schemas/
# re-login, enable "Cliplet"
```

**Measure the real thing** with the probe I added (`extension/src/perf.js`, free unless
enabled):

```sh
systemctl --user set-environment CLIPLET_PERF=1
# log out and back in, then:
journalctl -f -o cat /usr/bin/gnome-shell | grep 'cliplet:perf'
```

Open the picker with `Super+.`, type one letter, click an emoji. You should see:

```
[cliplet:perf] popup.open — 3.2 ms  mode=emoji built=true
[cliplet:perf] emoji.search — 0.9 ms  q="s"
[cliplet:perf] emoji.refresh — 6.1 ms  1416 entries, 90 cells live, build in flight
[cliplet:perf] insert — 21.4 ms  path=input-method
```

What to check:

- `insert … path=input-method` and a number in the tens of ms → the fast path is live.
  `path=clipboard+chord` means the app has no text-input support (expected for X11
  clients) and you are on the old ~250 ms path.
- `emoji.refresh … 90 cells live` on the first refresh, not ~1,400 → the lazy grid is
  working.
- **The clipboard test:** copy something, insert an emoji, then paste. If your original
  text comes back, the IM path ran; if the emoji comes back, you were on the chord path.

Please exercise the insert path in a spread of apps: a GTK4 app (Text Editor, Nautilus),
a terminal (Ptyxis, gnome-terminal), an Electron app (VS Code, Slack), Firefox, and one
X11 app. That is the one change I could not test here, and the fallback is designed so a
"no" in any of them costs you the old behaviour, not a lost emoji.

---

## 6. What is genuinely good (keep doing this)

- **The injection guard.** Recording the focus target at open and re-checking it at the
  last possible moment, with a "copied — the target changed" fallback instead of a
  best-effort paste, is the right design and the right failure mode.
- **The privacy spine.** MIME targets inspected before any content read;
  `x-kde-passwordManagerHint` never read; the hint-less re-offer suppressed by source
  type plus a 30 s window *without* reading it to hash it (rule 1 beating rule 3's
  wording is a real decision, and it is written down); persistence opt-in, text-only,
  and self-deleting.
- **Conflict handling that names the owner** and offers a reversible takeover, recording
  the previous binding for restoration — instead of failing silently or grabbing blindly.
  (Which is why bug §2.7 mattered so much: it defeated the whole design.)
- **Comments that explain *why*,** including the scars: the note that event *signals* on
  plain `St.Widget`s throw per event on Shell 50 and read as "the extension is slow",
  the `notify_keyval` microseconds note, the `St.Clipboard` content-ownership note. That
  is the single most useful thing in this repo for the next person.
- **`enable()`/`disable()` symmetry as an explicit acceptance checklist,** with the
  lock-screen flush documented.
- **Build-time data with a generator** rather than a runtime download, and hand-authored
  extras kept out of the generated file so regeneration cannot clobber them.

---

## Appendix — what changed on this branch

```
.gitignore                                                      6  compiled schema ignored
README.md                                                      48  insert path, dev + perf-probe docs
REVIEW.md                                                     432  this review
extension/extension.js                                         10  per-id grab retry token (silent Super+V failure)
extension/prefs.js                                              2  tone comment matched reality
extension/schemas/gschemas.compiled                           Bin  untracked: build artefact, stale binary wins
extension/schemas/…cliplet.gschema.xml                          5  emoji-tone range 0..5 (darkest tone)
extension/src/emojiData.js                                    146  regenerated: string keywords, coverage gaps closed
extension/src/emojiExtra.js                                     5  uppercase cp identity
extension/src/emojiModule.js                                  146  normalised index, settings snapshots, search fix
extension/src/injector.js                                      93  input-method fast path + pending-delivery cancel
extension/src/perf.js                                          51  opt-in CLIPLET_PERF probe
extension/src/popup.js                                        353  lazy grid, O(1) selection, star + NaN selection fixes
extension/src/snippets.js                                      22  mtime-guarded reload
extension/src/store.js                                         11  cached search haystack
extension/stylesheet.css                                        9  six tone chips fit the 520 px panel
tools/gen_emoji_data.py                                        17  string keywords, coverage ranges
tools/test/gi-stub.mjs                                         43  gi://GLib stub
tools/test/hooks.mjs                                           11  resolver hook
tools/test/run.mjs                                            529  52 assertions + perf report
```

Nothing here changes the public behaviour contract except the two insert-path
notes in §1 and the picker contents (+58 emoji, −21 duplicates, +1 skin tone).
