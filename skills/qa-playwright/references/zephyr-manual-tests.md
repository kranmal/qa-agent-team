# Manual tests for Zephyr Scale

Write a manual test only when automation is impossible (see test-design.md section 1) - and write down why.
Source of truth: `qa/manual/manual-tests.json`; `npm run zephyr:export` creates `zephyr-import.csv`.

## Style: plain English, concise, to the point

- Name: what is verified, under 10 words ("Password reset email arrives").
- Objective: one sentence, under 30 words.
- Precondition: only what must be true before step 1 (account, data, device).
- 3-10 steps. One action per step, under 25 words, imperative ("Click Pay now.").
- Test data on the step that uses it ("Card 4000 0000 0000 3220").
- Expected result on every step, observable and specific ("The page shows 'Payment confirmed'.").
- No jargon, no selectors, no code, no "verify that it works".
- Each test covers one thing. Boundary and error cases are separate short tests or extra steps.

## Entry format

```json
{
  "id": "MT-001",
  "name": "Password reset email arrives",
  "objective": "Check a real reset email is delivered and the link works once.",
  "precondition": "A registered user with access to their inbox.",
  "folder": "/QA/Auth",
  "priority": "High",
  "labels": ["manual", "email"],
  "covers": ["FR-005"],
  "reason": "Needs a real mailbox; the mail provider cannot be read from tests.",
  "steps": [
    { "step": "Open the login page and click Forgot password.", "expected": "The reset form is shown." },
    { "step": "Enter the registered email and submit.", "data": "jane@example.com", "expected": "The page says an email was sent." },
    { "step": "Open the email and click the reset link twice.", "expected": "First click opens the reset form. Second click shows 'Link expired'." }
  ]
}
```

`covers` ids must exist in the coverage matrix so coverage tracking counts the manual test.
Accessibility manual tests (see accessibility.md) use `labels: ["manual", "accessibility"]`.
