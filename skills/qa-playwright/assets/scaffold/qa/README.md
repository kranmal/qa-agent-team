# QA suite - {{PROJECT_NAME}}

Automated tests (Playwright + TypeScript, Vitest), coverage tracking, PDF reports and manual
Zephyr Scale tests. Everything runs from this `qa/` folder with plain npm - no Claude needed.

## 1. One-time setup

Requires Node.js 18+.

```bash
cd qa
npm install
npm run install:browsers
```

## 2. Point the tests at the app

The tests need the app running. Either start it yourself:

```bash
{{START_COMMAND}}          # in another terminal, from the project root
```

or let Playwright start it for you:

```bash
QA_WEB_SERVER="{{START_COMMAND}}" npm run test:e2e
```

Test against a different environment (staging, etc.) with `BASE_URL`:

```bash
BASE_URL=https://staging.example.com npm run test:e2e
API_BASE_URL=https://api.staging.example.com npm run test:api
```

{{TEST_ACCOUNTS_NOTE}}

## 3. Run the tests

| What | Command |
|---|---|
| Everything, then coverage check and both PDFs | `npm run test:all` |
| End-to-end (browser) tests | `npm run test:e2e` |
| API tests | `npm run test:api` |
| Unit / white-box tests with code coverage | `npm run test:unit` |
| Accessibility tests | `npm run test:a11y` |
| One file | `npx playwright test tests/e2e/login.spec.ts --project=e2e` |
| One test by name | `npx playwright test --project=e2e -g "FR-001"` |
| Watch the browser | add `--headed` |
| Step through a test | add `--debug` |
| Only boundary / error tests | `-g "@boundary"` / `-g "@error"` |

## 4. Reports

```bash
npm run report        # functional PDF  -> reports/qa-report-latest.pdf
npm run report:a11y   # accessibility PDF -> reports/a11y-report-latest.pdf
```

Run the matching test command first - reports are built from the latest run in `artifacts/`.
The functional report lists every test with its test data and a screenshot of each step
(API tests show request/response evidence instead). The accessibility report lists every
page/state scanned with screenshots and every violation found.

Quick look in the browser instead: `npx playwright show-report artifacts/html-report`.

## 5. Coverage

```bash
npm run coverage:check
```

Compares `coverage/coverage-matrix.json` (every feature in the app) against the tests and
writes `coverage/COVERAGE.md`. It fails if a feature has no test, lacks a boundary or error-handling
test, or if app source files exist that no feature points at. Unit code coverage is in
`artifacts/unit-coverage/index.html` after `npm run test:unit`.

## 6. Manual tests (Zephyr Scale)

Things that cannot be automated live in `manual/manual-tests.json`.

```bash
npm run zephyr:export
```

Import `manual/zephyr-import.csv` in Jira: Zephyr Scale > Test Cases > Import > Excel/CSV
(map columns in the wizard if prompted). `manual/manual-tests.md` is a readable copy.

## 7. Writing a test

Copy a pattern from an existing file in `tests/`. Rules:

- Title: `[REQ-ID] @kind description`, e.g. `[FR-004] @boundary quantity of 0 is rejected`.
  Kinds: `@happy`, `@boundary`, `@error`, `@blackbox`, `@whitebox`.
- Call `qa.data({...})` with the data the test uses.
- Wrap each action in `await qa.step('what happens', async () => {...})` - a screenshot is taken after every step.
- Add new features to `coverage/coverage-matrix.json` and re-run `npm run coverage:check`.

## Folder map

```
tests/e2e   browser tests          tests/api   API tests
tests/unit  white-box (Vitest)     tests/a11y  accessibility (axe)
fixtures/   qa.step / qa.data      helpers/    axe helper
coverage/   matrix + COVERAGE.md   manual/     Zephyr tests + CSV
scripts/    reports, coverage      artifacts/  raw results, screenshots (git-ignored)
reports/    generated PDFs
```
