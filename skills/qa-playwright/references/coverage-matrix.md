# Coverage matrix (`qa/coverage/coverage-matrix.json`)

The matrix is the single source of truth for "is everything tested". Build it by reading the
codebase, then keep it in sync on every change.

```json
{
  "project": "Acme Shop",
  "sourceRoots": ["../src", "../server"],
  "pages": [{ "name": "Login", "route": "/login" }],
  "requirements": [
    {
      "id": "FR-001",
      "area": "Auth",
      "description": "User signs in with email and password",
      "sources": ["src/pages/Login.tsx", "server/routes/login.ts"],
      "priority": "high",
      "exemptions": { "boundary": "no free-form inputs" },
      "manualReason": "Needs a real SMS delivered to a phone"
    }
  ]
}
```

- `id`: `PREFIX-###` (FR, API, UI, BL...). Tests reference it as `[FR-001]` in the title.
- Granularity: one requirement per user-visible behaviour or business rule - not per file, not per app.
  Login, logout, password reset, each form, each validation rule, each endpoint, each permission rule.
- `sources`: repo-relative files or folders (relative to the project root, not to qa/).
  Every source file under `sourceRoots` must be pointed at by at least one requirement, otherwise
  `coverage:check` reports it as unmapped. This is what catches new, untested code.
- `pages`: every user-facing route; each must appear in `tests/a11y`.
- `exemptions`: only with a real reason. Never exempt `error` on anything that calls a server.
- `manualReason`: required when the only coverage is a manual test.

## Status rules (computed, never hand-edited)

| Status | Meaning |
|---|---|
| automated | at least one e2e/api/unit test carries the id |
| manual | only manual tests carry the id (needs `manualReason`) |
| uncovered | nothing carries the id - must be fixed |

An automated requirement is only fully compliant with one `@boundary` test, one `@error` test and a
`@blackbox` or `@whitebox` tag, unless exempted.

## Beyond the matrix

- Unit code coverage: `vitest --coverage` with thresholds in `vitest.config.ts`. Raise thresholds when they are comfortably exceeded; never lower them to make a run pass.
- Optionally collect browser-side JS coverage from e2e runs (Chromium `page.coverage`, or `monocart-reporter`) if the project wants line-level numbers for e2e.
