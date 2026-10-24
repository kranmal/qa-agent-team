# Test design rules

## 1. Pick the highest level that can reach the behaviour

1. **E2E (Playwright, `tests/e2e`)** - default for anything a user can do in a browser.
2. **API (Playwright `request`, `tests/api`)** - when there is no UI path (webhooks, headless endpoints, auth edge cases the UI blocks) or the UI cannot produce the condition.
3. **Unit (Vitest, `tests/unit`)** - logic that no UI/API path can reach reliably: pure functions, parsers, calculators, branches behind feature flags, error branches.
4. **Manual (Zephyr Scale)** - only when automation is genuinely impossible: real email/SMS/push, third-party captcha or 3-D Secure, physical devices/hardware, native OS dialogs, visual judgement, live production data. Record the reason in `manualReason`.

**Persistence is never a manual test.** "Was it stored?" is proved by retrieving it through the app: save, then reload, reopen, search or GET it back and assert the value (e2e or API). Never write a test, automated or manual, that inspects database tables, files or logs by hand; if the app cannot read it back, that is a finding to report (or a read endpoint/test seam to request), not a manual check. Direct DB reads are allowed only inside automated tests for something no user or API path exposes (for example a hashed password or an audit row), via a test helper.

Before demoting to a lower level, try: `page.route()` to simulate failures, `context.setOffline()`,
`page.clock` for time, `storageState` for auth, `context.grantPermissions()`, `request.newContext()` for
seeding, test-mode keys for payment/email providers, and seeded data via API or DB scripts.

## 2. Black-box vs white-box

- **@blackbox**: derived from behaviour/requirements only. Inputs and visible outputs. All e2e and most API tests.
- **@whitebox**: derived from reading the code: every branch, guard clause, thrown error, default value, and internal state transition. Mostly unit tests, plus e2e/API tests written to reach a specific branch found in the code.
For each requirement, read its source files and list the branches; make sure each branch is hit by a test of either kind.

## 3. Boundary tests (`@boundary`) - every input

For every field, parameter, query string, header, file upload, and numeric/date/collection limit:
empty/null/missing, minimum, minimum-1, maximum, maximum+1, typical, whitespace-only, very long,
unicode/emoji, HTML/script/SQL-looking text (verify it is escaped/rejected, do not attack anything),
leading/trailing spaces, negative/zero/decimal numbers, date edges (leap day, DST, past/future limits),
empty list / one item / page-size edges / last page, file size and type edges.
Use the limits actually found in code, validation schemas and DB column sizes.

## 4. Error-handling tests (`@error`) - every dependency and rule

Validation errors (message text and focus), 400/401/403/404/409/422/429/500/503 responses, network
offline, timeouts, malformed JSON, duplicate submit/double click, expired session/token, unauthorised role,
concurrent edits, resource already deleted, partial failure. Assert the user sees a clear message,
the UI stays usable, no data is corrupted, and nothing sensitive leaks into the message.

## 5. Evidence rules

- Wrap every action in `qa.step()` so every step is screenshotted. Prefer many small steps over one big one: open page, fill field, submit, see result.
- `qa.data({...})` at the top of each test with every input value, account and expected result. These go straight into the PDF. Use test accounts only. Keys matching password/token/secret/key/authorization/cookie are masked in the report, but never put real credentials in tests.
- API/unit tests: `qa.response()` / `qa.evidence()` for request and response bodies.
- Loops that generate tests (boundary tables) must put the case in the title and in `qa.data`.

## 6. Reliability

Use role/label locators (`getByRole`, `getByLabel`), web-first assertions (`expect(locator)...`), no `waitForTimeout`,
no shared state between tests, unique data per test (include `testInfo.testId` or a timestamp in created records),
and clean up created data. If a test is flaky, fix the cause - never raise retries to hide it.
