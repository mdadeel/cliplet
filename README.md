<div align="center">
  <img src="assets/cliplet-logo.png" width="120" alt="Cliplet logo — stacked clipboard cards with a spark on a blue rounded square" />

# Cliplet

**Clipboard history & emoji picker in one popup — for GNOME Shell 50**

[![GNOME Shell 50](https://img.shields.io/badge/GNOME%20Shell-50-3584e4)](https://gnome.org)
[![Session](https://img.shields.io/badge/session-Wayland-4a90d9)](https://wayland.freedesktop.org)
[![Network](https://img.shields.io/badge/network-none-2ea44f)](#privacy--security)
[![Language](https://img.shields.io/badge/language-GJS%20%28JavaScript%29-f09662)](https://gjs.guide)

</div>

Cliplet is a **clipboard manager for GNOME and Linux** that keeps your **clipboard
history** and an **emoji picker** in one fast, keyboard-first popup — with
snippets, text transforms, MultiCopy collection, OCR and a jot pad built in.
It runs entirely inside GNOME Shell as a **GJS extension on Wayland**:
no daemons, no network access, no telemetry, and secrets from password
managers are never stored.

## Why Cliplet

GNOME has been Wayland-only since GNOME 50, and clipboard managers that
work outside the shell fight the compositor for every paste. Cliplet reads
and pastes **from inside the shell** — history capture, emoji insert and
paste injection are native, so there is no clipboard-watcher process, no
paste proxy, and no per-app fragility.

## Features

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
- **Panel indicator** — top-bar entry point with the Cliplet glyph: open
  popup (both modes), pause capture, jot pad, preferences; hidden entirely
  when all modules are off.
- **Shortcut conflict handling** — before binding, Cliplet names the owner
  of a held chord and offers an explicit, reversible takeover instead of
  failing silently.

## Keyboard shortcuts

| Action | Default | |
|---|---|---|
| Open clipboard history | `Super+V` | rebindable |
| Open emoji picker | `Super+.` | rebindable |
| OCR screen region | unbound | assign in Preferences |
| Toggle Jot Pad | unbound | assign in Preferences |

All chords are rebindable in **Preferences → Shortcuts**, where a held chord
is reported with its named owner and a take-over action.

## Install (GNOME Shell 50 — Ubuntu 26.04, Fedora, Arch)

```sh
# from a checkout of this repo
ln -s "$PWD/extension" ~/.local/share/gnome-shell/extensions/cliplet@review.local
glib-compile-schemas extension/schemas/
# then: re-login, enable "Cliplet" in the Extensions app
```

Requires GNOME Shell 50 (ESM extension, `settings-schema` metadata key).

## Privacy & security

- **No network, ever.** No telemetry, no sync, no downloads.
- Clipboard contents live in memory; secrets from password managers are
  detected by app hint and never stored.
- Disk persistence is opt-in (`persist-history`) and text-only — images and
  masked secrets are never written. Turning it off deletes the file.

## FAQ

**Does Cliplet work on X11?**
No — and that is deliberate. GNOME 50 removed the X11 session, and reading
the clipboard plus pasting into other apps can only be done reliably inside
the GNOME Shell Wayland process, which is exactly where Cliplet lives.

**Where is my clipboard data stored?**
In memory, bounded by the history limit. Nothing touches the disk unless
you enable `persist-history`, which writes text-only history (no images, no
masked secrets) to `~/.config/cliplet/history.json`. Disabling it deletes
the file.

**Does Cliplet connect to the internet?**
Never. There is no update check, no telemetry, no remote content.

**Why does Cliplet warn that Super+V is already taken?**
Stock GNOME and launcher apps can own the same chord. Cliplet names the
owner (for example a custom launcher binding) and offers a one-click,
reversible takeover instead of binding silently or failing quietly.

**What does the OCR feature need?**
The `tesseract` binary installed locally, plus the language packs you want
(`ocr-language` setting, e.g. `eng`). OCR is opt-in and runs entirely on
your machine.

## Repository layout

```
extension/   the GNOME Shell extension (ESM, gjs) — source of truth
tools/       python + node pipeline that composes and rasterises the
             design mockups (previews are workspace assets, not shipped)
assets/      brand art — README logo, social preview card
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
