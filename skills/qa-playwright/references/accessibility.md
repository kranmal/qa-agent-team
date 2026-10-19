# Accessibility testing

Based on https://playwright.dev/docs/accessibility-testing using `@axe-core/playwright`
(helper: `qa/helpers/a11y.ts`, template: `assets/templates/a11y.spec.ts.template`).

## What to scan

Walk the codebase's router/pages/components and scan every route, in every meaningful state:
default, loading/empty/populated, form validation errors, open menus/dropdowns/modals/dialogs/toasts,
logged-in vs logged-out, and a mobile viewport (`test.use({ viewport: { width: 375, height: 667 } })`).
One `qa.step()` per state change so each step is screenshotted, then `scanA11y(qa, page, name)`.
Scope with `include`/`exclude` only for third-party content, and say why in a comment.

## Tags

`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice` (set in `WCAG_TAGS`). Do not disable
rules to make a test pass; if a rule is a genuine false positive, `disableRules` it with a comment
and list it in the report notes.

## Keyboard and structure checks (automatable)

Tab order reaches every interactive control; focus is visible and never trapped (except in modals,
where Escape closes and focus returns to the trigger); forms submit with Enter; skip link works;
one `h1`, no skipped heading levels; landmarks present; images have alt; page has a title and `lang`;
errors are announced (`role="alert"` / `aria-live`). Use `expect(locator).toBeFocused()`,
`page.keyboard.press`, and `page.locator(':focus')`. Use `expect(page.locator('body')).toMatchAriaSnapshot(...)` for structure.

## What axe cannot decide (put these in Zephyr Scale as manual tests)

Screen reader announcements (NVDA/VoiceOver/JAWS), meaningful alt text and link text, logical reading order,
content at 200%/400% zoom and text spacing, colour use beyond contrast (e.g. state shown by colour only),
captions/transcripts for media, animation/motion safety, touch target comfort on a real device.
Axe `incomplete` results ("needs review") are listed per page in the PDF; create a manual test for each class of them.

## Report

`npm run test:a11y && npm run report:a11y` -> `reports/a11y-report-latest.pdf`: summary by impact,
violations by rule with help links, per-page table, and for every test the step screenshots plus
each violating element, its HTML and the suggested fix. Keep this separate from the functional report.
