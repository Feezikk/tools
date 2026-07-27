# Educator Assessment Checker — Modular Structure

This app was refactored from a single ~6,000-line `assessment_checker.html`
file into the structure below. **No functionality changed** — this was a
structural refactor only. See `VALIDATION_ANALYSIS.md` for the separate
validation-logic review.

## File layout

```
assessment_checker.html      Structure only: head, body markup, script tags
css/
  styles.css                 All styles (kept as one file — see note below)
js/
  config.js                  App-wide constants (CDN base path, empty-state HTML)
  state.js                   AppState (mutable runtime state) + DOM (cached element lookups)
  validation-rules.js        RULES_DATA — declarative rule definitions
  validation.js               AssessmentChecker engine: parses questions, runs every rule
  rendering.js                Turns a report into HTML (category sections, result cards, diffs)
  events.js                    Results-panel interactions: expand/collapse, copy, bulk auto-fix, filters
  app.js                       Bootstrap: wires every event listener — loads LAST
  modules/
    auto-fixers.js             One fix function per fixable rule id
    editor.js                  CodeMirror setup, Q-Mode gutter, tabs, file upload
    audit-runner.js             clearAll() / runAudit() — ties the editor to the engine
    find-replace.js             Find & Replace panel
    dashboard.js                Exam Dashboard modal
```

## Load order matters

All JS files are loaded as classic (non-module) `<script src>` tags, in the
exact order shown in `assessment_checker.html`. This preserves the original
file's top-to-bottom execution order exactly — the split only moved code
into separate files, it never reordered any logic (the one exception,
`config.js` loading before `state.js`, was verified to be safe: neither
file's top-level code depends on the other). `app.js` must stay last, since
it wires up every button/listener and references functions and variables
declared in every other file.

Because these are classic scripts (not ES modules), every top-level
`function` declaration attaches to the global scope automatically — this is
what keeps the HTML's existing `onclick="setFilter('all')"` attributes (and
the many similar `onclick="..."` strings the app generates dynamically in
`rendering.js`) working unchanged, regardless of which file the function
lives in.

## Why CSS wasn't split into 4 files

The suggested structure in the original brief proposed
`styles.css` / `layout.css` / `components.css` / `themes.css`. The actual
stylesheet (~300 lines) doesn't have natural seams along those lines — it's
one cohesive set of rules for a single-page tool with no theme-switching
today — so splitting it further would fragment related rules without a
real maintainability benefit. Kept as a single `css/styles.css`; revisit if
theming or a component library gets introduced later.

## Verifying the refactor didn't change behavior

- Every extracted `.js` file passes `node --check` (no syntax errors).
- The 12 JS files were reconstructed back into one script and diffed
  line-for-line (ignoring blank lines) against the original — content is
  identical, confirming no code was dropped, duplicated, or altered during
  the split.
- Every function referenced by an inline `onclick="..."` attribute (both
  in the static HTML and in dynamically generated result-card HTML) was
  confirmed to still be declared as a global `function` somewhere in `js/`.

## Changelog — Assessment Checker Updates

1. **Find and Replace "All" button renamed to "Replace All"**
   (`assessment_checker.html`) — label only, no logic change.
2. **SVG images may declare `width` on the `<img>` tag.**
   Two separate rules independently check image attributes, and both
   needed the exception:
   - `img-dimensions-check` (rule `img-no-dimensions`) in
     `js/validation.js` now checks the image's `src` for a `.svg`
     extension and, only in that case, skips the `width` check
     (`height` is still flagged for every image, SVG or not). The
     matching bulk auto-fixer in `js/modules/auto-fixers.js`
     (`img-no-dimensions`) was updated the same way, so "Fix All"
     won't strip a legitimate `width` off an SVG image.
   - `img-extra-attrs-check` (rule `img-extra-attributes`) — a
     separate "only src/alt/style are allowed" check — was also
     flagging `width` as an unexpected attribute on *every* image,
     including SVGs, since it didn't know about the exception above.
     It now skips `width` for `.svg` images too.
   Non-SVG image validation is unchanged in both rules.
3. **New "Math Course" checkbox** (`assessment_checker.html`, header,
   unchecked by default) — wired to `AppState.mathCourse` in
   `js/state.js` / `js/app.js`. When checked, `data-associatedlessons`
   is only required to exist and be non-empty (still enforced by the
   existing `span-data-associatedlessons` rule in `js/validation.js`);
   the ##.##R / ##.##H format rule (`span-associatedlessons-format`)
   and the visible-span-text-must-match-the-attribute rule
   (`span-content-match`, which would otherwise expect the descriptive
   text to appear verbatim inside the `(lesson complexity)` span text)
   are both skipped in that mode. Standard-course behavior for all
   three rules is unchanged when the box is left unchecked.

4. **HTML decimal entities (`&#nnnn;`) are recognized as valid HTML**,
   consistent with their named-entity/literal equivalents, in
   `js/validation.js`:
   - `img-alt-symbol-check` no longer flags a decimal or hex entity
     (e.g. `&#169;`) as a bare "ampersand" issue just because it
     contains `&`. `&#60;`/`&#x3C;` and `&#62;`/`&#x3E;` are now
     recognized identically to `&lt;`/`&gt;` (same "spell it out"
     message), `&#38;`/`&#x26;` identically to `&amp;`, and so on for
     every entity this rule already tracked (`&deg;`, `&ndash;`,
     `&mdash;`). A genuinely bare `&` (not part of any named or
     numeric entity) is still flagged as before.
   - `lt-gt-entities-check` (the "wrap `<`/`>` in `<span>`" rule) now
     treats `&#60;`/`&#x3C;` and `&#62;`/`&#x3E;` exactly like
     `&lt;`/`&gt;` — same span requirement, same normalization to the
     named entity in the suggested fix, and already-spanned decimal
     entities are recognized as valid and not re-flagged.
   - `img-alt-unknown-symbol-check` already handled this correctly
     (it strips valid `&#nnn;`/`&#xHHH;` references before scanning
     for unrecognized characters) — confirmed via test, no change
     needed there.

## Recommended next steps (manual QA)

Since this environment can't run a browser, please do a quick pass in an
actual browser before treating this as final:
1. Open `assessment_checker.html`, paste a sample assessment, click
   **Run Audit** — confirm the report renders as before.
2. Try the auto-fix (single item + "fix all"), Find & Replace, Q-Mode
   toggle, tab switching, file upload/clear, and the Exam Dashboard.
3. Confirm saved/exported files and any previously-saved settings still
   load correctly.
