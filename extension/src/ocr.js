// OCR & Screen to Text (docs/15 §3.1): opt-in, S9-exception module.
// Disabled unless the user installs tesseract (checked via PATH — no binary
// is bundled). Everything runs locally; nothing leaves the machine.
//
// Pipeline: crosshair area selection (own modal grab) → Shell.Screenshot
// streams PNG bytes → tesseract via GSubprocess (stdin→stdout) → the text
// becomes a history entry (app = "OCR") and the clipboard content, so the
// next Ctrl+V pastes it anywhere.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function isAvailable() {
    return GLib.find_program_in_path('tesseract') !== null;
}

// Recognize PNG bytes with tesseract (stdin → stdout). callback(text|null).
function recognize(pngBytes, lang, callback) {
    try {
        const subprocess = Gio.Subprocess.new(
            ['tesseract', 'stdin', 'stdout', '-l', lang],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_SILENCE);
        subprocess.communicate_utf8_async(GLib.Bytes.new(pngBytes), null, (proc, res) => {
            try {
                const [stdout] = proc.communicate_utf8_finish(res);
                callback(proc.get_exit_status() === 0 ? stdout : null);
            } catch (e) {
                callback(null);
            }
        });
    } catch {
        callback(null);
    }
}

const OcrSelector = GObject.registerClass({
    GTypeName: 'ClipletOcrSelector',
}, class OcrSelector extends St.Widget {
    vfunc_captured_event(event) {
        return this._handler ? this._handler(event) : Clutter.EVENT_PROPAGATE;
    }
});

export class Ocr {
    constructor({ settings, store, onToast, onDone }) {
        this._settings = settings;
        this._store = store;
        this._onToast = onToast;        // (message) => void
        this._onDone = onDone;          // () => void (e.g. reopen popup)
        this._root = null;
        this._grab = null;
    }

    // Entry point: start an area selection. Any failure is a toast, never a
    // silent nothing (V0b).
    start() {
        if (!isAvailable()) {
            this._onToast('OCR needs tesseract — install it (tesseract-ocr) and try again');
            return;
        }
        if (this._root) return;   // selection already running

        let monitor = Main.layoutManager.primaryMonitor;
        try {
            const idx = global.display.get_current_monitor();
            monitor = Main.layoutManager.monitors[idx] || monitor;
        } catch { /* use primary */ }

        this._root = new OcrSelector({
            reactive: true,
            x: monitor.x, y: monitor.y,
            width: monitor.width, height: monitor.height,
            style: 'background-color: rgba(0,0,0,0.25);',
        });
        this._rect = new St.Widget({
            style: 'border: 2px solid #3584e4; background-color: rgba(53, 132, 228, 0.08);',
        });
        this._root.add_child(this._rect);
        this._rect.hide();
        Main.layoutManager.uiGroup.add_child(this._root);

        this._start = null;
        this._root._handler = (event) => this._onEvent(event, monitor);
        this._grab = Main.pushModal(this._root, { actionMode: Shell.ActionMode.ALL });
    }

    _onEvent(event, monitor) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS &&
            event.get_key_symbol() === Clutter.KEY_Escape) {
            this._finish(null);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS) {
            const [x, y] = event.get_coords();
            this._start = { x: x - monitor.x, y: y - monitor.y };
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.MOTION && this._start) {
            const [x, y] = event.get_coords();
            this._updateRect(x - monitor.x, y - monitor.y);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE && this._start) {
            const [x, y] = event.get_coords();
            const end = { x: x - monitor.x, y: y - monitor.y };
            const rect = this._normalize(this._start, end);
            this._start = null;
            if (rect.w < 8 || rect.h < 8) {
                this._finish(null);
                return Clutter.EVENT_STOP;
            }
            this._shoot(rect, monitor);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _normalize(a, b) {
        return {
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
        };
    }

    _updateRect(x, y) {
        const r = this._normalize(this._start, { x, y });
        this._rect.set_position(r.x, r.y);
        this._rect.set_size(Math.max(2, r.w), Math.max(2, r.h));
        this._rect.show();
    }

    _shoot(rect, monitor) {
        const stream = Gio.MemoryOutputStream.new_resizable();
        const shot = new Shell.Screenshot();
        shot.screenshot_area(monitor.x + rect.x, monitor.y + rect.y, rect.w, rect.h,
            stream, (s, res) => {
                try {
                    s.screenshot_area_finish(res);
                    stream.close(null);
                    const bytes = stream.steal_as_bytes();
                    this._teardown();
                    this._recognize(bytes);
                } catch (e) {
                    this._teardown();
                    this._onToast(`Screenshot failed: ${e.message}`);
                }
            });
    }

    _recognize(pngBytes) {
        const lang = this._settings.get_string('ocr-language') || 'eng';
        recognize(pngBytes.get_data(), lang, (text) => {
            if (text === null || text.trim().length === 0) {
                this._onToast('OCR found no text');
                return;
            }
            const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
            this._store.add({
                text: trimmed,
                app: 'OCR',
                time: Date.now(),
            });
            this._onToast(`OCR complete — ${trimmed.length} chars (Ctrl+Z not supported)`);
            this._onDone();
        });
    }

    _teardown() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        global.stage.set_key_focus(null);
        this._root?.destroy();
        this._root = null;
        this._rect = null;
        this._start = null;
    }

    _finish(_) {
        this._teardown();
        this._onToast('OCR cancelled');
    }

    destroy() {
        this._teardown();
    }
}
