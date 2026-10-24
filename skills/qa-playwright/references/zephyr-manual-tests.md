# Manual tests for Zephyr Scale

Write a manual test only when automation is impossible (see test-design.md section 1) - and write down why.
Source of truth: `qa/manual/manual-tests.json`; `npm run zephyr:export` creates `zephyr-import.csv`.

A manual test is a *design*, not a transcript of clicks. First work out what the feature does and what
could break it, then write the fewest steps that exercise all of that.

## Principles

1. **Understand the feature, then choose data.** Read the code or page. List the rules (limits, formats,
   branches, error paths). Pick the smallest data set that covers each rule once, using these techniques:
   - `boundary` - just inside, on, and just outside each limit (min-1, min, max, max+1).
   - `error` - one representative invalid input per distinct error message or branch.
   - `blackbox` - behaviour from the requirement alone (typical valid input, equivalence classes).
   - `whitebox` - input chosen to take a specific code branch you found in the source.
   Do not test two values from the same equivalence class.
2. **Least steps, full coverage.** One step per distinct data variant or action. Combine checks that share
   a screen into one step ("Submit; check message and focus"). If 3 steps cover every rule, do not write 8.
3. **Always say how to get there.** Every test starts with exactly one *navigation* step, marked
   `"nav": true`, that goes from logging on to the screen under test, using real menu/page names
   ("Log in as the test user, then open Account > Security > Change password."). If no login exists, start
   from the URL. Then the feature steps. Nothing is assumed about where the tester starts.
4. **Test data is the data under test.** Put it in the step's `data`, labelled with its technique and why:
   `"data": "Password of 8 chars (boundary: min length)"`, `"data": "Empty email (error: required field)"`.
   Never put filler such as "any text". Every non-nav step that takes input has `data` and a `technique`.
5. **Expected results: clear and concise.** One observable outcome, under 20 words, naming the exact text,
   state or value ("Error 'Password too short' shown; form not submitted."). No "works correctly".
6. **No duplicated steps.** Every action+check pair appears in exactly one test. If two tests would repeat a
   step, either merge the tests, or keep it in one and rely on it in the other (drop it, and say so in
   `precondition`). Only the single navigation step may repeat across tests. Before finishing, review the
   whole file for duplicates (the `qa-manual-reviewer` agent does this) and merge or delete.
7. **Verify storage through the app, never the database.** If a step saves something, the next step retrieves it the way a user or API would (reload, reopen, search, view the record) and checks the value. Do not write steps like "check the table" or "query the database": if the app cannot show it, it is not a manual test; report it as a gap instead. Stored-and-retrievable data should already be covered by an automated test.
8. **One feature per test**, but one test may hold all of that feature's boundary/error variants as steps.

## Style

- Name: what is verified, under 10 words.
- Objective: one sentence, under 30 words.
- Precondition: only what must be true before step 1.
- Steps: imperative, one action each, under 25 words. No jargon, selectors or code.
- 3-10 steps including the navigation step.

## Entry format

```json
{
  "id": "MT-001",
  "name": "Password reset enforces length and one-time link",
  "objective": "Check reset rejects bad passwords and the emailed link works only once.",
  "precondition": "A registered user with access to their inbox.",
  "folder": "/QA/Auth",
  "priority": "High",
  "labels": ["manual", "email"],
  "covers": ["FR-005"],
  "reason": "Needs a real mailbox; the mail provider cannot be read from tests.",
  "steps": [
    { "nav": true, "step": "Open the site, click Log in, then Forgot password.", "expected": "Reset request form is shown." },
    { "step": "Submit the registered email.", "data": "jane@example.com (blackbox: valid)", "technique": "blackbox", "expected": "Page says an email was sent; email arrives." },
    { "step": "Open the link and set a password.", "data": "7 chars (boundary: min-1)", "technique": "boundary", "expected": "Error 'At least 8 characters'; password unchanged." },
    { "step": "Repeat with a longer password.", "data": "8 chars (boundary: min)", "technique": "boundary", "expected": "Password saved; confirmation shown." },
    { "step": "Click the same email link again.", "data": "Used link (error: one-time token)", "technique": "error", "expected": "Page shows 'Link expired'." }
  ]
}
```

`covers` ids must exist in the coverage matrix so coverage tracking counts the manual test.
Accessibility manual tests (see accessibility.md) use `labels: ["manual", "accessibility"]`.
