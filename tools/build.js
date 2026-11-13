// Build the preview PNGs: generate SVGs with python, rasterise with resvg.
//
// Failure policy (this used to be wrong):
//   - a missing SVG was skipped with a log line and the script still exited 0,
//     so a generator crash looked like a successful build;
//   - a python crash was reported by execSync but the exit code was lost inside
//     the resvg run that followed.
// Now: any generator failure or missing input aborts with a non-zero status, and
// the total is reported so a silently-dropped figure is visible.

const { Resvg } = require('@resvg/resvg-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SVGDIR = path.join(DIR, 'svg');
const OUT = path.join(DIR, '..', 'previews');
fs.mkdirSync(OUT, { recursive: true });

console.log('generating SVGs…');
try {
  execSync('python3 gen.py', { cwd: DIR, stdio: 'inherit' });
} catch (err) {
  console.error('\nFATAL: gen.py failed — no PNGs written.');
  process.exit(1);
}

// invariants first — a generator that produces subtly wrong output must fail the build
console.log('checking invariants…');
try {
  execSync('python3 check.py', { cwd: DIR, stdio: 'inherit' });
} catch (err) {
  console.error('\nFATAL: check.py reported problems — PNGs not written.');
  process.exit(1);
}

// scale is chosen per figure so the final PNG has a consistent visual weight
const jobs = [
  ['01-clipboard-default-dark.svg', '01-clipboard-default-dark.png', 2],
  ['02-clipboard-pinned-dark.svg', '02-clipboard-pinned-dark.png', 2],
  ['03-clipboard-search-dark.svg', '03-clipboard-search-dark.png', 2],
  ['04-clipboard-hover-actions.svg', '04-clipboard-hover-actions.png', 3],
  ['05-clipboard-image-preview.svg', '05-clipboard-image-preview.png', 2],
  ['06-clipboard-empty-light.svg', '06-clipboard-empty-light.png', 2],
  ['07-clipboard-default-light.svg', '07-clipboard-default-light.png', 2],
  ['08-emoji-default-dark.svg', '08-emoji-default-dark.png', 2],
  ['09-emoji-search-dark.svg', '09-emoji-search-dark.png', 2],
  ['10-emoji-categories-light.svg', '10-emoji-categories-light.png', 2],
  ['11-emoji-recents-favourites.svg', '11-emoji-recents-favourites.png', 2],
  ['12-emoji-tones-light.svg', '12-emoji-tones-light.png', 2],
  ['13-desktop-clipboard.svg', '13-desktop-clipboard.png', 1.5],
  ['14-desktop-emoji.svg', '14-desktop-emoji.png', 1.5],
  ['15-settings-dark.svg', '15-settings-dark.png', 2],
  ['16-direction-comparison.svg', '16-direction-comparison.png', 2],
  ['17-focus-rings-accessibility.svg', '17-focus-rings-accessibility.png', 2],
  ['18-architecture.svg', '18-architecture.png', 1.6],
  ['19-unified-clipboard-dark.svg', '19-unified-clipboard-dark.png', 2],
  ['20-unified-emoji-dark.svg', '20-unified-emoji-dark.png', 2],
  ['21-unified-emoji-search.svg', '21-unified-emoji-search.png', 2],
  ['22-unified-clipboard-light.svg', '22-unified-clipboard-light.png', 2],
  ['23-desktop-unified.svg', '23-desktop-unified.png', 1.5],
  ['24-shortcut-and-mode-flow.svg', '24-shortcut-and-mode-flow.png', 1.6],
  ['25-settings-shortcuts-emoji.svg', '25-settings-shortcuts-emoji.png', 1.6],
];

const missing = jobs.filter(([src]) => !fs.existsSync(path.join(SVGDIR, src)));
if (missing.length) {
  console.error('FATAL: gen.py did not produce:', missing.map(m => m[0]).join(', '));
  process.exit(1);
}

let written = 0;
for (const [src, dest, scale] of jobs) {
  const svg = fs.readFileSync(path.join(SVGDIR, src), 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    background: 'transparent',
  });
  const png = resvg.render().asPng();
  fs.writeFileSync(path.join(OUT, dest), png);
  written += 1;
  console.log('  ->', dest, (png.length / 1024).toFixed(0) + ' kB');
}

console.log(`done — ${written}/${jobs.length} previews written to ${OUT}`);
if (written !== jobs.length) process.exit(1);
