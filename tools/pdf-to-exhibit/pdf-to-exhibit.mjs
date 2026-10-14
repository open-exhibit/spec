#!/usr/bin/env node
// Splits a PDF into one JPEG per page, classifies each page (A4 / A3 / A2 /
// Square / custom, portrait or landscape) and writes an Open Exhibit document.
// See README.md in this directory.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_VERSION = '0.2.0';
const CLASSES = [
  'traditional', 'postal_history', 'postal_stationery', 'revenue_fiscal', 'thematic',
  'aerophilately', 'astrophilately', 'maximaphily', 'picture_postcards', 'fdc',
  'cinderella', 'display', 'experimental', 'illustrated_covers', 'topical', 'open',
  'one_frame', 'youth', 'literature',
];

// Nominal portrait sizes (mm). Long side is what we match against.
const ISO = [
  { preset: 'A4', w: 210, h: 297 },
  { preset: 'A3', w: 297, h: 420 },
  { preset: 'A2', w: 420, h: 594 },
];
const ISO_RATIO = Math.SQRT2;
const DEFAULTS = { ratioTol: 0.04, assumeIso: null };

const USAGE = `Usage: node pdf-to-exhibit.mjs <input.pdf> --title <title> --class <class> --ruleset <NAME:VERSION[:SUBCLASS]> [options]

Required:
  --title <text>          Exhibit title
  --class <class>         One of: ${CLASSES.join(', ')}
  --ruleset <spec>        e.g. FIP:2023 or FIP:2023:2C (repeatable)

Options:
  --out <dir>             Output directory (default: ./<pdf-name>-exhibit)
  --base-uri <url>        Public URL prefix the output dir will be served from.
                          Image URIs become <base-uri>/pages/page-001.jpg.
                          Default: file:// URIs of the local files.
  --dpi <n>               Render resolution (default 150)
  --quality <1-100>       JPEG quality (default 85)
  --cols <list>           Sheets per row by size, e.g. A4=4,Square=3,A3=2,A2=1.
                          Defaults: A4=4, Square=3, A3=2, A2=1; anything else
                          (landscape, custom) uses --frame-cols.
  --span <list>           Columns an A-series sheet takes in an A4 row (default A3=2,A2=4).
                          A4, A3 and A2 can share a row; the base cell is A4.
  --frame-cols <n>        Fallback sheets per row (default 4)
  --frame-rows <n>        Rows per frame (default 4)
  --subtitle <text>
  --author <name>  --email <email>
  --youth-age-group <a|b|c>   Required when class is youth
  --id <id>               Exhibit id (default: random UUID)
  --ratio-tol <f>         Relative tolerance on the long/short ratio (default 0.04)
  --assume-iso <A4|A3|A2> Force the ISO series when the PDF's physical size is unreliable
  --no-validate           Skip JSON Schema validation of the result
  -h, --help
`;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- analysis

/**
 * Classify a page from its rendered JPEG size (px) and its physical size (mm,
 * taken from the PDF page box). The aspect ratio (long/short) decides the
 * family, with a relative tolerance so slightly-off dimensions still match:
 * ~1 is Square, ~sqrt(2) is ISO 216, anything else is Custom. A4, A3 and A2
 * share the same ratio, so within the ISO family the series is the one whose
 * nominal long side is nearest to the physical size (log distance, no hard
 * cutoff); the further off it is, the lower the confidence.
 * `opts.assumeIso` ('A4'|'A3'|'A2') bypasses the physical size entirely.
 */
export function classifyPage(pxW, pxH, mmW, mmH, opts = {}) {
  const { ratioTol, assumeIso } = { ...DEFAULTS, ...opts };
  const landscape = pxW > pxH;
  const ratio = Math.max(pxW, pxH) / Math.min(pxW, pxH);
  const longMm = Math.max(mmW, mmH);
  const shortMm = Math.min(mmW, mmH);
  const base = { landscape, ratio: round(ratio, 4), mm: { width: round(mmW, 1), height: round(mmH, 1) } };

  if (Math.abs(ratio - 1) <= ratioTol) {
    return { ...base, kind: 'Square', confidence: 'high', size: { preset: 'Square' } };
  }

  if (Math.abs(ratio / ISO_RATIO - 1) <= ratioTol) {
    if (assumeIso) {
      const s = ISO.find((x) => x.preset === assumeIso);
      return withOrientation(base, s, 'medium', `size assumed ${assumeIso}`);
    }
    const nearest = ISO.reduce((a, b) =>
      Math.abs(Math.log(longMm / a.h)) < Math.abs(Math.log(longMm / b.h)) ? a : b);
    const err = Math.abs(longMm / nearest.h - 1);
    const confidence = err <= 0.05 ? 'high' : err <= 0.12 ? 'medium' : 'low';
    return withOrientation(base, nearest, confidence,
      confidence === 'low' ? `physical long side ${round(longMm, 0)} mm is far from ${nearest.preset}` : undefined);
  }

  return {
    ...base,
    kind: 'Custom',
    confidence: 'high',
    size: { dimensions_mm: { width: round(landscape ? longMm : shortMm, 1), height: round(landscape ? shortMm : longMm, 1) } },
  };
}

// The schema presets carry no orientation, so a landscape page is expressed
// with the preset's nominal dimensions_mm, rotated.
function withOrientation(base, s, confidence, note) {
  const out = { ...base, kind: s.preset, confidence };
  if (note) out.note = note;
  out.size = base.landscape
    ? { dimensions_mm: { width: s.h, height: s.w } }
    : { preset: s.preset };
  return out;
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const sizeKey = (size) => JSON.stringify(size);

// ------------------------------------------------------------------ layout

// Width of each A-series sheet in A4 cells, following the spec's example (an
// A3 is colspan 2 in an A4 row). Overridable with --span.
const A_SERIES = ['A4', 'A3', 'A2'];

/**
 * Lay sheets out left to right. Portrait A4/A3/A2 share rows whose base cell
 * is A4: an A3 takes `span.A3` columns (colspan), an A2 `span.A2`, and a row
 * closes when the next sheet would not fit in `colsFor(A4)` columns. Any other
 * size (Square, landscape, custom) gets uniform rows of its own size, so every
 * row's `size` still describes its base cell.
 *
 * @param sheets  [{ size, image }]
 * @param colsFor (size) => columns per row for that base size
 * @param span    { A3: n, A2: n } column span of larger A-series sheets
 */
export function buildFrames(sheets, colsFor, frameRows, span = { A3: 2, A2: 4 }) {
  const A4 = { preset: 'A4' };
  const isA = (size) => A_SERIES.includes(size.preset);
  const baseOf = (size) => (isA(size) ? A4 : size);
  const spanOf = (size) => (isA(size) ? (span[size.preset] ?? 1) : 1);

  const frames = [];
  let rows = []; // [{ size: base, used, items: [{ sheet, col, colspan }] }]

  const flush = () => {
    if (!rows.length) return;
    frames.push({
      frame_number: frames.length + 1,
      grid_rows: rows.length,
      grid_cols: Math.max(...rows.map((r) => r.used)),
      rows: rows.map((r) => ({ cols: r.used, size: r.size })),
      sheets: rows.flatMap((r, ri) => r.items.map((it) => ({
        position: { row: ri, col: it.col, ...(it.colspan > 1 && { colspan: it.colspan }) },
        size: it.sheet.size,
        image: it.sheet.image,
      }))),
    });
    rows = [];
  };

  for (const sheet of sheets) {
    const base = baseOf(sheet.size);
    const colspan = Math.min(spanOf(sheet.size), colsFor(base));
    let row = rows[rows.length - 1];
    if (!row || sizeKey(row.size) !== sizeKey(base) || row.used + colspan > colsFor(base)) {
      if (rows.length >= frameRows) flush();
      row = { size: base, used: 0, items: [] };
      rows.push(row);
    }
    row.items.push({ sheet, col: row.used, colspan });
    row.used += colspan;
  }
  flush();
  return frames;
}

// -------------------------------------------------------------------- main

async function renderPages(pdfPath, outDir, dpi, quality, opts) {
  const data = new Uint8Array(await readFile(pdfPath));
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    standardFontDataUrl: pathToFileURL(path.join(HERE, 'node_modules/pdfjs-dist/standard_fonts/')).href,
    cMapUrl: pathToFileURL(path.join(HERE, 'node_modules/pdfjs-dist/cmaps/')).href,
    cMapPacked: true,
  });
  const doc = await task.promise;

  const pagesDir = path.join(outDir, 'pages');
  await mkdir(pagesDir, { recursive: true });
  const pad = String(doc.numPages).length < 3 ? 3 : String(doc.numPages).length;
  const pages = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 }); // honours /Rotate; units = points
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const jpg = canvas.toBuffer('image/jpeg', quality);
    const file = `page-${String(i).padStart(pad, '0')}.jpg`;
    await writeFile(path.join(pagesDir, file), jpg);

    // Analyse the file we actually wrote, not the in-memory canvas.
    const img = await loadImage(jpg);
    const analysis = classifyPage(img.width, img.height, (base.width * 25.4) / 72, (base.height * 25.4) / 72, opts);
    pages.push({
      page: i,
      file: `pages/${file}`,
      px: { width: img.width, height: img.height },
      bytes: jpg.length,
      sha256: createHash('sha256').update(jpg).digest('hex'),
      analysis,
    });
    page.cleanup();
    process.stdout.write(`\r  rendered ${i}/${doc.numPages}`);
  }
  process.stdout.write('\n');
  await task.destroy();
  return pages;
}

function parseRuleset(spec) {
  const [name, version, subclass, ...rest] = spec.split(':');
  if (!name || !version || rest.length) fail(`bad --ruleset "${spec}", expected NAME:VERSION[:SUBCLASS]`);
  return subclass ? { name, version, subclass } : { name, version };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: 'string' }, subtitle: { type: 'string' }, class: { type: 'string' },
      ruleset: { type: 'string', multiple: true }, out: { type: 'string' }, 'base-uri': { type: 'string' },
      dpi: { type: 'string', default: '150' }, quality: { type: 'string', default: '85' },
      'frame-cols': { type: 'string', default: '4' }, cols: { type: 'string' }, span: { type: 'string' }, 'frame-rows': { type: 'string', default: '4' },
      author: { type: 'string' }, email: { type: 'string' }, 'youth-age-group': { type: 'string' },
      'ratio-tol': { type: 'string', default: String(DEFAULTS.ratioTol) }, 'assume-iso': { type: 'string' },
      id: { type: 'string' }, 'no-validate': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(USAGE);
  if (positionals.length !== 1) fail(`expected exactly one PDF path\n\n${USAGE}`);
  if (!values.title) fail('--title is required');
  if (!CLASSES.includes(values.class)) fail(`--class must be one of: ${CLASSES.join(', ')}`);
  if (!values.ruleset?.length) fail('at least one --ruleset is required');
  if ((values.class === 'youth') !== Boolean(values['youth-age-group'])) {
    fail('--youth-age-group is required for class youth and not allowed otherwise');
  }
  const num = (k, min, max = Infinity) => {
    const n = Number(values[k]);
    if (!Number.isInteger(n) || n < min || n > max) fail(`--${k} must be an integer >= ${min}`);
    return n;
  };
  const dpi = num('dpi', 30, 600);
  const quality = num('quality', 1, 100);
  const ratioTol = Number(values['ratio-tol']);
  if (!(ratioTol > 0 && ratioTol < 0.2)) fail('--ratio-tol must be between 0 and 0.2');
  const assumeIso = values['assume-iso'];
  if (assumeIso && !ISO.some((s) => s.preset === assumeIso)) fail('--assume-iso must be A4, A3 or A2');
  const frameCols = num('frame-cols', 1);
  const frameRows = num('frame-rows', 1);
  const colsByPreset = { A4: 4, Square: 3, A3: 2, A2: 1 };
  for (const part of (values.cols ?? '').split(',').filter(Boolean)) {
    const [k, v] = part.split('=');
    if (!(k in colsByPreset) || !Number.isInteger(Number(v)) || Number(v) < 1) fail(`bad --cols entry "${part}"`);
    colsByPreset[k] = Number(v);
  }
  const span = { A3: 2, A2: 4 };
  for (const part of (values.span ?? '').split(',').filter(Boolean)) {
    const [k, v] = part.split('=');
    if (!(k in span) || !Number.isInteger(Number(v)) || Number(v) < 1) fail(`bad --span entry "${part}"`);
    span[k] = Number(v);
  }
  const colsFor = (size) => colsByPreset[size.preset] ?? frameCols;

  const pdfPath = path.resolve(positionals[0]);
  const outDir = path.resolve(values.out ?? `${path.basename(pdfPath, path.extname(pdfPath))}-exhibit`);
  await mkdir(outDir, { recursive: true });

  console.log(`Rendering ${pdfPath} @ ${dpi} dpi`);
  const pages = await renderPages(pdfPath, outDir, dpi, quality, { ratioTol, assumeIso });

  const uriFor = (rel) => values['base-uri']
    ? `${values['base-uri'].replace(/\/+$/, '')}/${rel}`
    : pathToFileURL(path.join(outDir, rel)).href;

  const sheets = pages.map((p) => ({
    size: p.analysis.size,
    image: {
      uri: uriFor(p.file),
      media_type: 'image/jpeg',
      checksum: { algorithm: 'sha256', value: p.sha256 },
    },
  }));

  const exhibit = {
    spec_version: SPEC_VERSION,
    id: values.id ?? randomUUID(),
    title: values.title,
    ...(values.subtitle && { subtitle: values.subtitle }),
    ...((values.author || values.email) && {
      author: { ...(values.author && { name: values.author }), ...(values.email && { email: values.email }) },
    }),
    class: values.class,
    ...(values['youth-age-group'] && { youth_age_group: values['youth-age-group'] }),
    rulesets: values.ruleset.map(parseRuleset),
    frames: buildFrames(sheets, colsFor, frameRows, span),
  };

  await writeFile(path.join(outDir, 'exhibit.json'), JSON.stringify(exhibit, null, 2) + '\n');
  await writeFile(path.join(outDir, 'analysis.json'), JSON.stringify(pages, null, 2) + '\n');

  console.log('\n page  px            mm             detected          confidence');
  for (const p of pages) {
    const a = p.analysis;
    const label = a.kind === 'Square' ? 'Square' : `${a.kind} ${a.landscape ? 'landscape' : 'portrait'}`;
    console.log(
      ` ${String(p.page).padStart(4)}  ${`${p.px.width}x${p.px.height}`.padEnd(12)}  ` +
      `${`${a.mm.width}x${a.mm.height}`.padEnd(13)}  ${label.padEnd(16)}  ${a.confidence}${a.note ? `  (${a.note})` : ''}`);
  }
  const low = pages.filter((p) => p.analysis.confidence === 'low').length;
  if (low) console.warn(`\nwarning: ${low} page(s) with low-confidence size; review analysis.json`);

  if (!values['no-validate']) {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const schema = JSON.parse(await readFile(path.join(HERE, '../../schema/exhibit.schema.json'), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    if (!ajv.validate(schema, exhibit)) {
      console.error('\nGenerated document failed schema validation:');
      console.error(ajv.errorsText(ajv.errors, { separator: '\n' }));
      process.exit(2);
    }
    console.log('\nSchema validation: OK');
  }
  console.log(`Wrote ${path.join(outDir, 'exhibit.json')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
