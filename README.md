# Open Exhibit

An open, application-neutral schema for representing a philatelic exhibit's
**physical and top-level structure** — not tied to any particular
exhibiting/judging software's internal database.

Status: **v0.2, draft.** Originally incubated inside the
[ExhibitGrader](https://github.com/exhibitgrader) app's repo; this is now
its own repository under the `open-exhibit` organization, with its own
versioning and license (MIT). See [CHANGELOG.md](CHANGELOG.md).

## Scope

In scope:
- Exhibit-level identity: title, subtitle, author (name/email, both
  optional), class, synopsis.
- The exhibit's class, from a shared vocabulary that covers the FIP-style
  classes plus the classes APS (and others) have that FIP does not. For
  a youth exhibit, the exhibitor's age group (`youth_age_group`).
- Which judging ruleset(s) the exhibit targets, by reference (e.g.
  `FIP 2023`, `APS 2022`) — the ruleset's own criteria/rubric are *not*
  part of this format. An exhibit can target more than one ruleset at
  once (e.g. the same physical exhibit competes under both FIP and APS).
  `subclass` lives *inside* each ruleset reference, not at the exhibit
  level, because subclass taxonomies and numbering (e.g. FIP Postal
  History "2C") are specific to each federation, not to the exhibit
  itself — the same exhibit can be "2C" under FIP and unclassified (or
  differently classified) under APS.
- The synopsis, either as text (`synopsis`) or as page images
  (`synopsis_pages`) — one or the other.
- Physical structure: frames, the sheet grid within a frame (optionally
  with a different column count and base cell size per row), and each
  sheet's position, size, and image.

Note: `subclass` is a free string for now — this schema does not
validate that it's a real subclass for that (ruleset, class) pair.
Subclass taxonomies change per federation more often than the physical
structure does, so cross-referencing them against a controlled
vocabulary is left for a future, separately-versioned `vocab/`
companion, not the core schema.

Explicitly out of scope (for now, possibly forever):
- Per-sheet text content (titles/descriptions per sheet) — the format
  only carries the exhibit-level synopsis.
- Catalog references (Scott/Michel/SG numbers, certificates, rarity
  claims).
- Judging/scoring data — this format describes the exhibit, not an
  evaluation of it.
- How an application transports the document or authenticates the
  request (that is each application's own API, which may embed an
  Open Exhibit document).

## Layout

```
schema/
  exhibit.schema.json   JSON Schema (2020-12) for an Exhibit instance
examples/
  traditional-example.json
  postal-history-2c-example.json
  youth-example.json          youth age group, mixed row sizes, synopsis as page images
  aps-display-example.json    an APS-only class
  invalid/                    documents the schema must reject (useful as validator tests)
tools/
  pdf-to-exhibit/       Node.js tool: PDF -> JPEG pages + Open Exhibit document
README.md
CHANGELOG.md
LICENSE
```

## Images

Each sheet (and each synopsis page) carries an `image` with an absolute `uri`.
The consumer fetches it, so the producer must keep it reachable for as long as
the consumer needs it: a producer that keeps images private should hand out
time-limited (signed) URIs. JPEG and PNG are the expected formats;
`media_type` is an optional hint and `checksum` (sha256) is recommended so the
consumer can verify what it fetched. Limits (maximum size, maximum number of
sheets) are the consumer's, not the format's.

## Mapping application vocabularies

Applications often have finer-grained class lists than this format. The
convention is: the *class* is the coarse, shared vocabulary; whatever an
application encodes as a "sub-class" goes in the ruleset reference's
`subclass`. For example, ExhibitGrader's internal classes map as follows.

| Application class | `class` | Ruleset reference `subclass` | Other |
|---|---|---|---|
| `traditional`, `postal_history`, `postal_stationery`, `thematic`, `aerophilately`, `astrophilately`, `maximaphily`, `picture_postcards`, `fdc`, `cinderella`, `display`, `experimental`, `illustrated_covers`, `topical` | same name | — | |
| `postal_history_2c` | `postal_history` | FIP: `2C` | |
| `revenue` (FIP) | `revenue_fiscal` | — | |
| `revenue_traditional` (APS) | `revenue_fiscal` | APS: `traditional` | |
| `revenue_fiscal_history` (APS) | `revenue_fiscal` | APS: `fiscal_history` | |
| `open_philately` | `open` | — | |
| `youth_traditional` | `youth` | `traditional` | `youth_age_group` |
| `youth_thematic` | `youth` | `thematic` | `youth_age_group` |

## Versioning

The format has its own `spec_version` (semver), independent of
ExhibitGrader's app version. Breaking changes bump the major version;
new optional fields (e.g. a new `class` value) bump the minor version.
While the version is 0.x, minor versions may still tighten things, but a
document valid against 0.1 stays valid against 0.2.

## Validating an instance

Any standard JSON Schema (2020-12) validator works, e.g. with
[ajv-cli](https://github.com/ajv-validator/ajv-cli):

```
npx ajv-cli validate -s schema/exhibit.schema.json -d examples/traditional-example.json --spec=draft2020
```

or with Python's `jsonschema` (`Draft202012Validator`, `FormatChecker()`).
Everything under `examples/` (except `examples/invalid/`) must validate and
everything under `examples/invalid/` must be rejected.

Some rules can't be expressed in JSON Schema and are left to the consumer:
that `rows.length` equals `grid_rows`, that a sheet fits within its row's
`cols`, and that sheets don't overlap. They are documented on the fields.

A reference parser/SDK is not planned for v0 — the format is intentionally
just data + schema for now. The one tool in this repo,
[pdf-to-exhibit](#generating-a-starting-point-from-a-pdf), is a convenience
for producers, not a normative part of the format.

## Generating a starting point from a PDF

[`tools/pdf-to-exhibit`](tools/pdf-to-exhibit/) is a small Node.js command-line
tool that turns a PDF of an exhibit into a ready-to-edit Open Exhibit document:

```
cd tools/pdf-to-exhibit && npm install
node pdf-to-exhibit.mjs exhibit.pdf --title "Birds on Stamps" --class thematic   --ruleset FIP:2023 --base-uri https://cdn.example.org/exhibits/abc --out out
```

It writes:

- one JPEG per PDF page (`out/pages/page-001.jpg`, …);
- `out/exhibit.json`, validated against the schema, with an `image` (URI,
  `media_type`, sha256 `checksum`) for every sheet;
- `out/analysis.json`, the per-page detection details.

For each page it detects the sheet size — `A4`, `A3`, `A2`, `Square`, or custom
`dimensions_mm` for anything else, portrait or landscape — from the page's
aspect ratio and physical size, and reports a confidence so doubtful pages can
be reviewed. It then lays the sheets out into frames (several sheet sizes can
share a row, using `colspan`).

Treat the result as a **starting point, not a finished document**. The frame
layout is a heuristic (columns per row and rows per frame are configurable, and
your real frames may differ), the sheet order is the PDF's page order, and the
tool knows nothing about the exhibit's synopsis, author details or
subclass beyond what you pass on the command line. Review and adjust
`exhibit.json` before publishing it. Because the output is plain JSON that
follows the schema, the same approach is a good base for automating spec
generation in other pipelines — see the tool's
[README](tools/pdf-to-exhibit/README.md) for the options and the detection
rules.
