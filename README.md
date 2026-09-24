# Open Exhibit

An open, application-neutral schema for representing a philatelic exhibit's
**physical and top-level structure** — not tied to any particular
exhibiting/judging software's internal database.

Status: **v0, draft.** Originally incubated inside the
[ExhibitGrader](https://github.com/exhibitgrader) app's repo; this is now
its own repository under the `open-exhibit` organization, with its own
versioning and license (MIT).

## Scope

In scope:
- Exhibit-level identity: title, subtitle, author (name/email, both
  optional), class, synopsis.
- Which judging ruleset(s) the exhibit targets, by reference (e.g.
  `FIP 2023`, `APS 2022`) — the ruleset's own criteria/rubric are *not*
  part of this format. An exhibit can target more than one ruleset at
  once (e.g. the same physical exhibit competes under both FIP and APS).
  `subclass` lives *inside* each ruleset reference, not at the exhibit
  level, because subclass taxonomies and numbering (e.g. FIP Postal
  History "2C") are specific to each federation, not to the exhibit
  itself — the same exhibit can be "2C" under FIP and unclassified (or
  differently classified) under APS.
- Physical structure: frames, the sheet grid within a frame, and each
  sheet's position, size, and image.

Note: `subclass` is a free string for now — this schema does not
validate that it's a real subclass for that (ruleset, class) pair.
Subclass taxonomies change per federation more often than the physical
structure does, so cross-referencing them against a controlled
vocabulary is left for a future, separately-versioned `vocab/`
companion, not the core schema.

Explicitly out of scope (for now, possibly forever):
- Per-sheet text content (titles/descriptions per sheet) — the format
  only carries the exhibit-level synopsis as free text.
- Catalog references (Scott/Michel/SG numbers, certificates, rarity
  claims).
- Judging/scoring data — this format describes the exhibit, not an
  evaluation of it.

## Layout

```
schema/
  exhibit.schema.json   JSON Schema (2020-12) for an Exhibit instance
examples/
  traditional-example.json
  postal-history-2c-example.json
README.md
LICENSE
```

## Versioning

The format has its own `spec_version` (semver), independent of
ExhibitGrader's app version. Breaking changes bump the major version;
new optional fields (e.g. a new `class` value) bump the minor version.

## Validating an instance

Any standard JSON Schema (2020-12) validator works, e.g. with
[ajv-cli](https://github.com/ajv-validator/ajv-cli):

```
npx ajv-cli validate -s schema/exhibit.schema.json -d examples/traditional-example.json --spec=draft2020
```

A reference parser/SDK is not planned for v0 — the format is intentionally
just data + schema for now.
