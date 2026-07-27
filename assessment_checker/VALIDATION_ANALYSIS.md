# Validation & Rule Evaluation — Analysis and Recommendations

This document is the required output of the validation-review stage of the
refactor. It covers: overlapping checks, conflicting rules, duplicate
warnings, rule dependencies, and recommendations — split into **required
changes** and **optional improvements**, per the spec.

## Summary

The engine (`js/validation.js`) evaluates 72 rules (`js/validation-rules.js`)
against every question in the pasted assessment, in the fixed array order
they appear in `RULES_DATA`. No priority/ordering system beyond that array
order exists, and none is needed: **almost every handler is fully
independent**, and the few genuine overlaps were already resolved with
explicit guards or a post-processing suppression pass. This review found
**no conflicting rules and no duplicate-warning bugs** to fix. What follows
is the map of the existing (correct) dependencies, plus optional
consolidation opportunities for long-term maintainability.

## Rule Dependencies Already In Place (documented, unchanged)

These are now documented directly in `js/validation.js` (see the "RULE
EXECUTION ORDER & DEPENDENCY MAP" comment block near the top of the file)
so future contributors don't have to rediscover them by reading 2,000+
lines of handler code:

1. **groups-points family** — `group-sequence`, `group-numbering`,
   `group-type-consistency`, `same-group-same-points`, and
   `group-meta-consistency` all skip any question with `group === null`.
   That defers to `group-present`, which is the rule that reports a
   missing `group:` line — so one missing field produces one error, not
   a cascade of "group looks wrong" errors on the same question.
2. **tf-answer / tf-answer-present** — `tf-answer-present` explicitly
   skips a question where `tf-answer` (both `true` and `false` present)
   already fired.
3. **table-tag-pairs / table-structure-malformed** — the table
   "structure" sub-check skips a table once `table-tag-pairs` has already
   found broken/unmatched tags in it, since column counts aren't
   reliable on a broken table.
4. **malformed-html-tag / lt-gt-entities** — the entities check
   suppresses bare `<`/`>` fragments that look like part of a broken tag,
   deferring to the malformed-tag rule for those.
5. **img-alt-symbol-check** — known HTML entities (`&gt;`, `&deg;`, …)
   take priority over bare symbols in the same alt text; an entity match
   suppresses the bare-symbol check so only the more specific message
   shows.
6. **accessible-symbols-minus / en-dash-context** — the minus-sign check
   explicitly excludes en dashes on non-answer lines, deferring entirely
   to `en-dash-context` for that character.
7. **en-dash-context / special-chars-auto** (post-processing, in `run()`)
   — after all rules run, any en dash entry already reported by
   `en-dash-context` is stripped out of that question's
   `special-chars-auto` result (and the whole result dropped if that
   empties it), so the more specific message wins and the character
   isn't flagged twice.

No case was found where a later rule produces a misleading result because
an earlier, more fundamental check had already failed — every dependency
above is a genuine one-issue-one-message safeguard, not a workaround for a
missed prerequisite.

## Overlapping-Checks Review

Families of rules that check related things but were confirmed to check
genuinely **different conditions** (not overlapping, no action needed):

- `img-inline-needs-valign` / `img-standalone-has-valign` /
  `img-ambiguous-valign` / `img-absmiddle` — each targets a distinct,
  mutually exclusive image-alignment scenario.
- `img-has-alt` / `img-alt-quotes` / `img-alt-html` /
  `img-alt-symbol-words` / `img-alt-unknown-symbol` — `img-has-alt`
  requires a *non-empty* alt attribute; the other four extract the alt
  text with a regex that tolerates an empty or missing match and bail
  out early (`if (!a) return [];`), so an image with no alt attribute at
  all is only ever flagged once, by `img-has-alt`. Confirmed no
  double-reporting, including for the `alt=""` edge case.
- `special-chars-auto` / `special-chars-review` / `accessible-symbols-degree`
  / `accessible-symbols-minus` — each targets a distinct character class;
  the only real overlap (en dashes) is the suppression in item 7 above.

## Required Changes

**None.** No conflicting rules or duplicate-warning bugs were found in this
review, so no behavior-changing fixes were made — consistent with the
refactor's "preserve existing functionality" requirement.

## Optional Improvements (recommended, not implemented)

These are consolidation opportunities that would reduce duplicated code
without changing behavior. They're left as recommendations rather than
applied directly, since the refactor's priority was a safe, mechanical
split — these are genuine logic edits and deserve their own
review/test pass before being merged.

1. **Duplicated `<img>`-tag extraction regex.** The pattern
   `` /<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi `` (or a near-identical variant)
   appears independently in at least 9 rule handlers in `validation.js`
   (`img-alt-check`, `img-quote-check`, `img-extension-check`,
   `img-alt-quotes-check`, `img-alt-html-check`, `img-alt-symbol-check`,
   `img-alt-unknown-symbol-check`, `img-dimensions-check`,
   `img-path-check`, and a variant in `img-extra-attrs-check`).
   Recommendation: extract a single `extractImgTags(line)` helper at the
   top of `validation.js` (or a new `js/utilities.js`) and have every
   handler call it, rather than repeating the regex literal.
2. **Duplicated alt-text extraction regex.** The pattern
   `` /alt\s*=\s*"([^]*?)"(?=\s*\/?>|\s+[a-z]+(?:=|\s|>))/i `` is repeated
   verbatim in 4 handlers (`img-alt-quotes-check`, `img-alt-html-check`,
   `img-alt-symbol-check`, `img-alt-unknown-symbol-check`).
   Recommendation: extract a single `extractAltText(img)` helper next to
   `extractImgTags`.
3. **No formal rule-dependency metadata.** Today, dependencies (item 1–7
   above) are enforced by ad-hoc guards scattered through handler bodies.
   That's fine at 72 rules, but if the rule set keeps growing, consider
   adding an optional `runsAfter: ['rule-id']` field to `RULES_DATA` and
   having `run()` sort rules topologically before executing — mainly so
   new dependencies are declared in the data file (visible at a glance)
   rather than discovered by reading handler code. Not necessary now.
4. **Split `RULES_DATA` by category.** At ~530 lines in one object, the
   rules data file is manageable, but if more rules are added,
   consider splitting `validation-rules.js` into
   `validation-rules/{images,tables,groups-points,...}.js` files that are
   merged into `RULES_DATA` at load time. Left as-is for now since the
   current size is still easy to navigate and search.

## Where this fits in the refactor

Per the incremental-refactor guidance, this analysis was performed as
stage 7–9 (review validation rules for overlap/conflicts; consolidate
where appropriate; document recommendations) with **no consolidation
applied**, since none was required to fix a genuine bug — only the
optional items above are on the table for a future pass.
