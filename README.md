# Cliplet

> Clipboard history and emoji picker in one popup — a GNOME Shell 50 extension.

Cliplet is a review build of a unified clipboard manager: text and image
history, an emoji/kaomoji picker, snippets, text transforms, OCR and a jot
pad, all reachable from one 520×540 popup shell (or the panel indicator)
with zero network access.

## Highlights

- **One popup, two modes** — `[ Clipboard | Emoji ]` segmented switcher;
  search across both, keyboard-first navigation, pointer-complete.
- **Clipboard history** — bounded recents with pins, dedupe, per-row app and
  age metadata, image rows (opt-in, memory-only, ≤8 MB), file/URI entries,
  day grouping, right-click row menus.
- **Paste anywhere** — rows paste via virtual keyboard injection at the
  cursor; `Enter` pastes, click copies (mode shown live in the footer).
- **MultiCopy queue** — Ctrl+click rows to collect, paste-all joins with
  newlines.
- **Text transforms** — 9 pure transforms (case, trim, sort, dedupe, …)
  applied from the row menu, undoable with Ctrl+Z.
- **Snippets** — user-authored, saved to `~/.config/cliplet/snippets.json`,
  pasted without entering history.
- **Emoji picker** — categories, search (exact-name ranked above substring),
  skin tones, recents/favourites, plus kaomoji and symbol extras. Inserts at
  the cursor on click — Windows behaviour, no double-click needed.
- **Jot Pad** — always-on-top scratch text with debounced autosave to
  `~/.config/cliplet/jot.txt`.
- **OCR** — select a screen region, tesseract reads it into history
  (opt-in; requires `tesseract` installed locally; graceful install-hint
  toast when absent).
- **Panel indicator** — open popup (both modes), pause capture, jot pad,
  preferences; hidden entirely when all modules are off. Branded with the
  Cliplet glyph (`extension/icons/`).
- **Shortcut conflict handling** — before binding, Cliplet names the owner
  of a held chord and offers an explicit, reversible takeover instead of
  failing silently.

## Privacy

- **No network, ever.** No telemetry, no sync, no downloads.
- Clipboard contents live in memory; secrets from password managers are
  detected by app hint and never stored.
- Disk persistence is opt-in (`persist-history`) and text-only — images and
  masked secrets are never written. Turning it off deletes the file.

## Install

```sh
# from a checkout of this repo
ln -s "$PWD/extension" ~/.local/share/gnome-shell/extensions/cliplet@review.local
glib-compile-schemas extension/schemas/
# then: re-login, enable "Cliplet" in the Extensions app
```

Defaults: `<Super>v` opens clipboard, `<Super>period` opens emoji — both
rebindable in Preferences → Shortcuts, where held chords are reported with
a named owner and a take-over action. OCR and jot pad ship unbound; assign
them in the same page. Requires GNOME Shell 50 (ESM extension,
`settings-schema` metadata key).

## Repository layout

```
extension/   the GNOME Shell extension (ESM, gjs) — source of truth
tools/       python + node pipeline that composes and rasterises the
             design mockups (previews are workspace assets, not shipped)
```

Design-time assets — the mockup SVG/PNG gallery and the research & design
review docs — are kept out of the repository. Regenerate the gallery
locally with `node tools/build.js` (or `python3 tools/gen.py` for SVGs
only); `tools/check.py` enforces layout and content invariants. Emoji
artwork used by the mockups is Google's Noto 3D emoji set (SIL OFL 1.1);
the extension itself ships no emoji artwork — it renders through the
user's system emoji font.

## Status

Review build: popup, capture, injection, snippets, transforms, MultiCopy,
images, OCR and the jot pad are implemented and verified headless on
GNOME Shell 50.1 (Ubuntu 26.04). Persistence is opt-in; images are
memory-only by design.
