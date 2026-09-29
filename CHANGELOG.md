# Changelog

## 0.2.0 (draft)

Additive: every document valid against 0.1.0 is still valid.

- `class`: added `astrophilately`, `picture_postcards`, `fdc`, `cinderella`, `display`, `experimental`, `illustrated_covers`, `topical` (classes that exist in FIP or APS but were missing).
- New `youth_age_group` (`a`/`b`/`c`): required when `class` is `youth`, forbidden otherwise.
- New `synopsis_pages`: the synopsis as page images, an alternative to the text `synopsis` (the two are mutually exclusive).
- New optional `frame.rows`: per-row column count and base cell size, for frames whose rows differ.
- `image`: new optional `media_type` (`image/jpeg`, `image/png`); `uri` and `checksum` documented (signed URIs, sha256 recommended). `size` and `image` are now shared definitions.
- `$id` now points at the repository instead of `example.org`.
- Two new examples (`youth-example.json`, `aps-display-example.json`) and `examples/invalid/` (documents a validator must reject).
- README: image guidance and the class mapping convention.

## 0.1.0

Initial draft: exhibit identity, class, rulesets by reference, frames, sheets, images.
