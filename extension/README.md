# Cliplet — review build (R3-aligned core)

Implementation of the V1 core from `docs/09` as revised by `docs/13` (R2) and
the R3 fixed-window note. Installed for local review as
`cliplet@review.local`.

**Verified on this machine (Ubuntu 26.04.1, GNOME Shell 50.1, Wayland) via an
isolated headless-shell harness** (`/tmp/cliplet-headless/`, the docs/05 §5.6
pattern): extension loads ACTIVE; `enable()`/`disable()` clean with zero JS
errors; capture works for real Wayland-app copies and shell-internal sets;
`x-kde-passwordManagerHint` offers are never stored; popup opens/closes in
both modes; emoji search returns results (1,380 build-time entries).

## What is in (and out) of this build

| Spec | Status |
|---|---|
| F1 capture (`Meta.Selection::owner-changed` + 100 ms debounce) | in |
| F2 text capture, MIME fallback | in (text + uri-list/gnome-copied-files) |
| F3 popup, first row pre-selected, fixed 640×596 (R3) | in |
| F4 paste into focused app (virtual keyboard) | in, guarded (F5 fallback) |
| F6 pins (survive clear) | in |
| F7 delete + single-level undo (Ctrl+Z / ⋯ menu, 4 s window) | in |
| F8 sensitive suppression: hint check + re-offer window | in — see notes |
| F9 memory-only | in; nothing touches disk |
| F10 emoji: search, recents-by-use, tones, favourites | in |
| F11 independent module toggles | in (disabled module = no signal, no data) |
| F12 light/dark + accent | in (read at popup open) |
| F13 keyboard-complete | in, with two deviations below |
| F14 size caps (100 KiB/item default, 200 items) | in |
| F15 startup deferral (`startup-complete` guard) | in |
| F19 images | **out** (D4 deferred, as agreed for this build) |
| F17 per-app exclusions | out (V3 prerequisite unverified) |
| F24 open-at-caret | out (V5 unverified; opens at pointer, falls to centre) |

## Known deviations (flag for design review)

1. **`Ctrl+P` pins, `Ctrl+F` favourites, `Ctrl+T` tone** instead of bare
   `P`/`F`/`T` — bare letters collide with the search field (typing "pizza"
   would pin). Same resolution may be wanted for the spec.
2. **`1–9` quick-pick only while the search field is empty** — same collision.
3. **Re-offer suppression heuristic**: the hinted offer is never read (DR-07),
   so there is no text hash to compare. A memory-source owner arriving ≤30 s
   after a hinted skip, with nothing legitimately captured in between, is
   treated as the re-offer and dropped. Needs the V14 KeePassXC test; if the
   window misfires either way, tune `REOFFER_WINDOW_S` in `src/capture.js`.
4. **Undo** is Ctrl+Z / ⋯→Undo inside the popup (4 s toast), not a shell
   notification action.
5. **Paste as plain text** (`Alt+Enter`) is identical to paste here: the store
   is text-only, so every entry is already plain text.
6. **Conflict report** names only stock `org.gnome.shell.keybindings` owners
   (scanned live) and reports failed grabs as "another component owns it".
   Per V0b, anything more would be guessing.

## API facts verified against Shell 50.1 (worth keeping)

- **`Main.pushModal` event delivery requires vfuncs on a `GObject.registerClass`
  subclass** (`vfunc_captured_event`, the ModalDialog pattern). Signal connects
  on a plain St.Widget throw "Virtual function not implemented" per event.
- **Scrolling**: St.ScrollView's child must be an `St.Viewport` (implements
  `St.Scrollable`) — a plain BoxLayout leaves the adjustment blind
  (`upper == pageSize`). With `vscrollbar_policy: NEVER` the built-in wheel
  handling (which lives on the never-created scrollbar) does nothing — wheel
  events must adjust `vadjustment` manually. Content minimum otherwise
  inflates the fixed window: header/body/footer heights are pinned
  (54 + 498 + 44 = 596).
- `Clutter.BoxLayout` takes `orientation` (not `vertical`) in mutter 18;
  `St.Viewport` takes no layout shorthand either.
- `owner-changed` args are `(selection, type, newOwner, oldOwner)`.
- `St.Clipboard.get_default()` takes **no** display argument.
- Virtual keyboard: `Clutter.get_default_backend().get_default_seat()
  .create_virtual_device(KEYBOARD_DEVICE)`; `notify_key(time_us, keycode,
  state)` — **microseconds**, evdev keycodes; `KeyState {RELEASED:0, PRESSED:1}`.
- `main.js` exports **named** symbols: `import * as Main from
  'resource:///org/gnome/shell/ui/main.js'`.
- `metadata.json` needs `"settings-schema"` for `Extension.getSettings()`.
- St.Widget takes `layout_manager`, not `layout`.
- Extensions are scanned only at shell startup: a fresh install needs a
  re-login on Wayland (no live rescan, Eval unavailable).

## Try it

1. Log out and back in (Wayland cannot restart the shell in place).
2. Press `Super+V` → clipboard popup; `Super+.` → emoji mode; `Tab` switches.
3. `Enter` paste · `Alt+Enter` plain text · `Ctrl+Enter` copy · `Ctrl+P` pin ·
   `Delete` remove (Ctrl+Z undo) · `Esc` close.
4. Preferences: `gnome-extensions prefs cliplet@review.local`.
5. Watch for errors: `journalctl --user -b | grep -i cliplet`.

Note for smoke tests: `wl-copy` worked against this build in the harness, but
treat copy-paste matrix results as V4 work.

## Files

```
extension.js            lifecycle + wiring
prefs.js                GTK4/Adw preferences (separate process)
stylesheet.css          Direction A tokens, dark+light scoped classes
src/capture.js          capture spine (P1–P8, hint + re-offer, masks)
src/store.js            memory store, pins, dedupe, undo
src/injector.js         focus guard + virtual-device paste
src/keybindings.js      grab/ungrab + conflict report
src/popup.js            one shell, two modes, 640×596 fixed
src/emojiModule.js      recents-by-use, favourites, tones, search
src/emojiData.js        GENERATED by tools/gen_emoji_data.py — do not edit
```
