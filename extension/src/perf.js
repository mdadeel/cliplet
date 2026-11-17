// Opt-in timing probe.
//
// Everything in this module is free unless CLIPLET_PERF=1 is in the shell's
// environment, so it can stay in the shipped code: one getenv at import, and
// a boolean test per call site. Output goes to the session journal
// (`journalctl -f -o cat /usr/bin/gnome-shell`), tagged `[cliplet:perf]`.
//
// Turn it on for the shell process, then log out and back in:
//
//   systemctl --user set-environment CLIPLET_PERF=1
//   journalctl -f -o cat /usr/bin/gnome-shell | grep cliplet:perf
//
// The flag is read once at import, so setting it from Looking Glass after the
// shell has started is too late.

import GLib from 'gi://GLib';

const ENABLED = GLib.getenv('CLIPLET_PERF') === '1';
const _marks = new Map();

function emit(label, us, detail) {
    console.log(`[cliplet:perf] ${label} — ${(us / 1000).toFixed(2)} ms${detail ? `  ${detail}` : ''}`);
}

export const perf = {
    get enabled() { return ENABLED; },

    // perf.time('search', () => results, `${results.length} hits`)
    time(label, fn, detail = '') {
        if (!ENABLED) return fn();
        const start = GLib.get_monotonic_time();
        try {
            return fn();
        } finally {
            emit(label, GLib.get_monotonic_time() - start, detail);
        }
    },

    // paired: perf.start('open') … perf.end('open', 'mode=emoji')
    start(label) {
        if (ENABLED) _marks.set(label, GLib.get_monotonic_time());
    },

    end(label, detail = '') {
        if (!ENABLED) return;
        const start = _marks.get(label);
        if (start === undefined) return;
        _marks.delete(label);
        emit(label, GLib.get_monotonic_time() - start, detail);
    },
};
