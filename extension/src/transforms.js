// Text transforms (docs/15 §1.1): pure functions over clip text. No shell
// imports — trivially testable and importable from anywhere.

export const TRANSFORMS = {
    'Trim spaces': (t) => t.split('\n')
        .map((l) => l.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''))
        .join('\n')
        .trim(),
    'Remove line breaks': (t) => t.replace(/\s*\n\s*/g, ' ').trim(),
    'Collapse blank lines': (t) => t.replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, ''),
    'UPPERCASE': (t) => t.toUpperCase(),
    'lowercase': (t) => t.toLowerCase(),
    'Title Case': (t) => t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    'Sort lines': (t) => t.split('\n').sort((a, b) => a.localeCompare(b)).join('\n'),
    'Dedupe lines': (t) => [...new Set(t.split('\n'))].join('\n'),
    'URL-decode': (t) => {
        try {
            return decodeURIComponent(t.replace(/\+/g, ' '));
        } catch {
            return t;   // malformed escape — leave the clip untouched
        }
    },
};
