---
name: qa-playwright
description: This skill should be used when the user asks to QA, test, or "get test coverage" for a codebase; to write Playwright/TypeScript end-to-end, API, Vitest, or accessibility tests; to generate a test report PDF; or to create manual Zephyr Scale tests. It reads the codebase, builds a coverage matrix, writes screenshot-per-step tests with boundary and error-handling cases, tracks coverage, produces functional and accessibility PDF reports, and a README for running everything without Claude.
---

# QA with Playwright

Produce a complete, self-running QA suite in `<project>/qa/` for any codebase, keep its coverage
complete as the code changes, and report results as PDFs.

Bundled resources (read on demand):
- `assets/scaffold/qa/` - the suite skeleton to copy into the project (config, `qa` fixture, axe helper, scripts, README template).
- `assets/templates/*.template` - example e2e, api, unit and a11y tests to adapt (not part of the scaffold, so no fake tests run).
- `references/test-design.md` - test level ladder, black/white-box, boundary and error checklists, evidence rules. **Read before writing tests.**
- `references/coverage-matrix.md` - matrix schema and rules. **Read before building the matrix.**
- `references/accessibility.md` - what/how to scan, manual a11y checks. Read before the a11y phase.
- `references/zephyr-manual-tests.md` - manual test style and JSON format. Read before writing manual tests.

## Workflow

### 1. Orient (skip questions that the repo answers)

1. Detect stack, start command, port, auth method, test accounts/seed data, existing tests, and CI (`package.json`, `README`, `docker-compose`, `.env.example`, routers, API routes, DB schema).
2. If `qa/` exists, this is an **update run**: read `qa/coverage/COVERAGE.md` and the matrix, run `npm run coverage:check`, and only add what is missing or changed. Do not overwrite existing tests, the matrix or manual tests; edit them.
3. Ask the user only for what cannot be found: base URL if the app is deployed elsewhere, credentials for a *test* account (never production secrets), and anything destructive to avoid.
4. Never run tests against production or with real user data. Prefer local or staging; state which `BASE_URL` is used.

### 2. Scaffold (new runs only)

Copy `assets/scaffold/qa/` to `<project>/qa/` (`cp -R`, keep dotfiles). Then:
- Fill `{{PROJECT_NAME}}`, `{{START_COMMAND}}`, `{{TEST_ACCOUNTS_NOTE}}` in `qa/README.md` (delete the placeholder line if no accounts).
- Set `project` and `sourceRoots` in `qa/coverage/coverage-matrix.json`; point `vitest.config.ts` coverage `include` at the real source folders.
- Set the default `baseURL` in `playwright.config.ts` to the project's dev URL.
- `cd qa && npm install && npx playwright install chromium`.

### 3. Build the coverage matrix

Read the code (routes/pages, components with behaviour, API handlers, services, validators, auth/permissions, jobs) and list every user-visible behaviour and business rule as a requirement with `sources` (see `references/coverage-matrix.md`). Add every user-facing route to `pages`. Also read each requirement's source for branches, limits and thrown errors: these drive boundary, error and white-box tests. The matrix must account for every source file.

### 4. Choose a level for each requirement, then write tests

Follow the ladder in `references/test-design.md`: **Playwright e2e first**, then API tests, then Vitest unit tests, and manual Zephyr tests only when automation is genuinely impossible (record `manualReason`).

Every automated test must:
- Carry `[REQ-ID]` and a kind tag in the title (`@happy`, `@boundary`, `@error`, `@blackbox`, `@whitebox`).
- Call `qa.data({...})` with all test data used.
- Wrap each action in `qa.step()` so every step is screenshotted (API/unit: `qa.response()` / `qa.evidence()`).
- Include, per requirement, at least one `@boundary` and one `@error` test (or a justified exemption in the matrix), and cover both black-box behaviour and white-box branches found in the code.

Use the templates in `assets/templates/` as patterns. Write tests by feature area, one file per area, and run each file as soon as it is written (`npx playwright test <file> --project=e2e`); fix failures before moving on. A failing test is either a bug in the test (fix it) or a real defect in the app (leave the test asserting correct behaviour, mark it `test.fail()` only if the user agrees, and report it clearly). Never weaken an assertion to get green.

### 5. Accessibility suite (separate)

Per `references/accessibility.md`: for every page and state in the matrix `pages`, add a test in `tests/a11y` that steps through the flow (screenshot per step) and calls `scanA11y`. Add keyboard-navigation tests. Anything axe cannot decide becomes a manual Zephyr test labelled `accessibility`.

### 6. Manual tests

For each requirement that could not be automated, add a test to `qa/manual/manual-tests.json` (principles, format and style in `references/zephyr-manual-tests.md`): the fewest steps that fully cover the feature, a first step that navigates from login to the feature, labelled boundary/error/blackbox/whitebox test data, concise expected results, and `covers` ids. Then review the whole file for duplicate steps across tests (the `qa-manual-reviewer` agent does this) and run `npm run zephyr:export`. Review warnings from the exporter and fix them. Manual tests are mandatory wherever automation cannot reach: the deliverable is always `manual/zephyr-import.csv` (Zephyr Scale format), and the functional PDF lists them in a "Manual tests (Zephyr Scale)" section.

### 7. Coverage gate

Run `npm run coverage:check`. It must exit 0: every requirement covered, boundary and error tests present, every source file mapped, every page has an a11y test. Fix gaps by adding tests/matrix entries, not by adding exemptions. Commit `coverage/COVERAGE.md` as the running record. Run `npm run test:unit` and meet the Vitest thresholds.

### 8. Run everything and report

Run `npm run test:all` (runs all suites, continues past failures, checks coverage, builds both PDFs), or run the pieces individually. Deliverables in `qa/reports/`:
- `qa-report-latest.pdf` - all tests, the test data used per test, screenshot of each step, API evidence, coverage table, failures.
- `a11y-report-latest.pdf` - separate accessibility report with screenshots and violations.
- `bug-report-latest.pdf` - every confirmed defect with severity, description, how to recreate, expected vs actual, and screenshots. Confirm each real app defect by recording it in `qa/bugs/bugs.json` (`id`, `title`, `severity`, `test` = unique part of the failing test title, `summary`, `steps` = plain-English repro, `expected`, `actual`); serious/critical accessibility violations are added automatically; other failures appear as "unconfirmed" until triaged. Run `npm run report:bugs`.
Open at least one PDF (or render a page to an image) to check it is not empty and screenshots appear.

### 9. Hand over

Final message to the user: pass/fail counts, coverage percentage and any known gaps, defects found in the app, where the PDFs, `COVERAGE.md`, `manual/zephyr-import.csv`, and `qa/README.md` are, and the exact command to re-run everything. Confirm the README steps work from a clean checkout (`npm install`, `npm run install:browsers`, `npm run test:e2e`).

## Keeping coverage complete over time

On every later run (new feature, bug fix, refactor): run `npm run scan:changes` first. It hashes the source files (or snapshots the live pages when there is no source) and compares them with `coverage/baseline.json`, writing `coverage/CHANGES.md`: new/unmapped code, modified code with the requirements it affects, deleted code, changed UI that needs an a11y re-scan, changed pages and new routes. Write the functional and a11y tests it lists, then once green run `npm run scan:changes -- --accept` to record the new baseline (do this on the first full run too). Then update the matrix, run `npm run coverage:check`, and let its failures define the work: uncovered requirements, missing `@boundary`/`@error` tests, unmapped new source files, pages without a11y tests. Re-run the full suite and regenerate both PDFs. Treat a dropped Vitest threshold as a failure.

## Guardrails

- Test accounts and fake data only; never write real secrets into tests, the matrix, or the README.
- Do not alter app source code to make tests pass unless the user asks; add `data-testid` attributes only if no accessible locator exists and tell the user.
- Keep generated output in `qa/artifacts/` (git-ignored) and `qa/reports/`.
- Leave the user's existing test setup alone; the `qa/` folder is self-contained with its own `package.json`.
