# pdf-to-exhibit

Splits a PDF into one JPEG per page, classifies each page's sheet size
(`A4` / `A3` / `A2` / `Square` / custom, portrait or landscape) and writes an
Open Exhibit document (`exhibit.json`) plus `analysis.json` with the per-page
details. The result is validated against `../../schema/exhibit.schema.json`.

```
npm install
node pdf-to-exhibit.mjs exhibit.pdf --title "Birds on Stamps" --class thematic \
  --ruleset FIP:2023 --base-uri https://cdn.example.org/exhibits/abc --out out
```

Run with `--help` for all options.

## Size detection

1. The long/short **aspect ratio** of the rendered JPEG, with a relative
   tolerance (`--ratio-tol`, default 4%), picks the family: ~1 is `Square`,
   ~1.414 is ISO 216, anything else is custom (`dimensions_mm`).
2. A4, A3 and A2 share the same ratio, so the ISO series is chosen by the PDF
   page's physical size (nearest nominal long side, no hard cutoff). Confidence
   drops to `medium`/`low` the further off it is; use `--assume-iso A4` when the
   PDF carries no meaningful physical size (e.g. scans at arbitrary scale).
3. Landscape pages are emitted as `dimensions_mm` (the schema's presets carry
   no orientation).

## Layout

Sheets fill frames left to right. Portrait A4, A3 and A2 can share a row whose
base cell is A4: an A3 is `colspan` 2 and an A2 `colspan` 4 (`--span`, following
the spec's example), and the row closes at `--cols A4=` columns (default 4), so
2 A4 + 1 A3 fill one row. Square, landscape and custom sizes get rows of their
own (`--cols`, defaults Square=3; others use `--frame-cols`). Rows per frame:
`--frame-rows`.
