# QA Agent Team for Claude Code

A team of five Claude Code agents plus a skill that plan, write, run and report on a full QA suite (Playwright + TypeScript, API, Vitest, accessibility, Zephyr Scale manual tests, and PDF reports) for a codebase or a live site.

## Quick start (the short version)

Do these in order. One step at a time. You can't skip ahead and break anything.

**You will end up with:** test PDFs, a bug PDF, and a CSV for Zephyr. 🎯

### Step 1. Install it (once, 1 minute)

```bash
git clone https://github.com/kranmal/Vibe_Portfolio_Projects.git
cd Vibe_Portfolio_Projects/qa-agent-team
./install.sh
```

✅ Done when it says it copied the agents. Never do this step again.

### Step 2. Go to the project you want to test

```bash
cd /path/to/your/project
```

No project, just a website? Make an empty folder and go in there.

### Step 3. Start the lead agent

```bash
claude --agent qa-lead
```

Use exactly this. It has to be the *lead*, because only the lead can call the other agents.

### Step 4. Tell it what to test. One sentence.

Pick one and paste it:

- Website: `QA https://your-site.com. Read-only, no logins.`
- Your app: `QA this project. It runs at http://localhost:3000, start it with npm run dev.`

Got a test login? Say so. Never give it a real password.

### Step 5. Wait

It works alone now. It writes the tests, runs them, fixes broken tests and builds the reports. Go and get a coffee. ☕ (A real site can take a while.)

### Step 6. Grab your files

Everything is in the `qa/` folder it made:

| You want | Open this |
|---|---|
| Test results | `qa/reports/qa-report-latest.pdf` |
| Accessibility results | `qa/reports/a11y-report-latest.pdf` |
| Bugs it found | `qa/reports/bug-report-latest.pdf` |
| Manual tests for Zephyr | `qa/manual/zephyr-import.csv` |

Start with the bug PDF. That's the important one.

### Step 7. Later, when your code changes

Don't start over. Start the lead again (Step 3) and say:

`Scan for changes and update the tests.`

It finds what is new, writes only the missing tests, and updates the reports. That's it.

### If something goes wrong

| Problem | Fix |
|---|---|
| `qa-lead` not found | Run `./install.sh` again (Step 1) |
| A test failed | Normal. Open the bug PDF. Real bugs are meant to fail |
| Report looks stale | Say: `Re-run everything and rebuild the reports` |
| Confused | Say: `Explain where we are in plain English` |

---

## Use it from Claude desktop

The `interface/` folder has an MCP server and a live dashboard, so you can start and follow runs from Claude desktop chat. See [interface/README.md](interface/README.md).

---

## Install

### Requirements
- [Claude Code](https://claude.com/claude-code) (CLI, desktop or IDE)
- Node.js 18+ (the generated test suites run on it; Claude installs the Playwright browser for you)

### Steps

```bash
git clone https://github.com/kranmal/Vibe_Portfolio_Projects.git
cd Vibe_Portfolio_Projects/qa-agent-team
./install.sh
```

This copies:
- the 6 agents to `~/.claude/agents/` (`qa-lead`, `qa-spec-writer`, `qa-test-runner`, `qa-report-builder`, `qa-change-scanner`, `qa-manual-reviewer`)
- the `qa-playwright` skill to `~/.claude/skills/qa-playwright/`

Options:

| Command | Result |
|---|---|
| `./install.sh` | Install for your user, available in every project. Existing copies are skipped. |
| `./install.sh --project` | Install into `./.claude` of the current directory instead, so it lives with one project (run it from the project root). |
| `./install.sh --force` | Replace existing copies; the old ones are backed up as `*.bak.<timestamp>`. |

To install by hand, copy `agents/qa-*.md` into `~/.claude/agents/` and `skills/qa-playwright/` into `~/.claude/skills/`.

### Check it worked

```bash
ls ~/.claude/agents | grep qa-   # 5 files
claude --agent qa-lead
```

Restart Claude Code if it was already running. Inside a session, `/agents` lists the five agents.

### Uninstall

```bash
rm ~/.claude/agents/qa-*.md && rm -r ~/.claude/skills/qa-playwright
```

---
A team of five Claude Code agents that plan, write, run and report on a full QA suite for a codebase or live site, using the `qa-playwright` skill for the rules, templates and scaffold.

## Example output

`examples/bbc/` holds reports from a real run against https://www.bbc.co.uk (black-box, read-only, no logins):

| File | What it is |
|---|---|
| `qa-report.pdf` | Functional report: coverage percentages, boundary and error-handling section, test data and screenshots per test |
| `a11y-report.pdf` | Accessibility report (WCAG, axe-core). From an earlier run, before BBC changed its home page layout |
| `bug-report.pdf` | Bug report: severity, description, how to recreate, expected vs actual, screenshots |
| `zephyr-import.csv` | Manual tests in Zephyr Scale CSV format |

These are real findings on a third-party site at the time of the run, shown as a sample only.

## What it produces

In `<project>/qa/`:

| Output | Where |
|---|---|
| Playwright (TypeScript) e2e, API, Vitest and accessibility tests, each with boundary and error-handling cases, test data, and a screenshot per step | `tests/` |
| Coverage matrix and running record | `coverage/coverage-matrix.json`, `coverage/COVERAGE.md` |
| Manual tests for Zephyr Scale (plain English, CSV import format) | `manual/manual-tests.json`, `manual/zephyr-import.csv` |
| Functional test report PDF: coverage percentages, boundary and error-handling section, test data, screenshots | `reports/qa-report-latest.pdf` |
| Accessibility report PDF (WCAG, axe-core) | `reports/a11y-report-latest.pdf` |
| Bug report PDF: severity, description, how to recreate, expected vs actual, screenshots | `reports/bug-report-latest.pdf` |
| Instructions for running everything without Claude | `qa/README.md` |

## The agents

Files live in `~/.claude/agents/`.

| Agent | Job |
|---|---|
| `qa-lead` | Orchestrator. Orients, scaffolds `qa/`, builds the coverage matrix, splits work by feature area, starts the other agents, enforces the coverage gate, writes the handover. |
| `qa-change-scanner` | Scans the codebase (or live site) for changes since the last full-coverage baseline and produces a grouped work plan of functional and accessibility tests to add. Writes no tests. |
| `qa-spec-writer` | One per feature area, run in parallel. Writes happy, boundary and error tests (black-box and white-box), accessibility tests, and proposes manual Zephyr tests. Edits only the files it owns. |
| `qa-test-runner` | One only. Runs all suites one at a time, triages each failure as app defect, test bug or flake, fixes test bugs, and records confirmed defects in `qa/bugs/bugs.json`. |
| `qa-manual-reviewer` | One only, after the spec writers. Reviews every manual test together: removes duplicate steps across tests, trims each to the fewest steps with full coverage, and checks route from login, labelled test data and concise expected results. |
| `qa-report-builder` | Exports the Zephyr CSV, builds the three PDFs, and checks each one renders correctly. |

```
qa-lead
  ├─ qa-change-scanner    (update runs: what changed, which tests are needed)
  ├─ scaffold + coverage matrix (new runs)
  ├─ qa-spec-writer x N   (parallel, one per area)
  ├─ coverage gate        (coverage:check + typecheck)
  ├─ qa-test-runner       (single, sequential suites)
  └─ qa-report-builder    (PDFs + Zephyr CSV)
```

## How to use it

Start `qa-lead` as the main agent. A sub-agent cannot start other sub-agents, so this is what lets it fan out.

```bash
cd /path/to/your/project
claude --agent qa-lead
```

Then give it a target, for example:

- `QA this project. App runs at http://localhost:3000, start with npm run dev.`
- `QA https://www.example.com. Black-box, read-only, no logins or form submissions.`
- `Update run: we added a checkout feature, bring coverage back to complete.`

In the Claude desktop app you can instead ask the session to run the QA team on a folder; it acts as the lead and starts the other three.

You can also use one agent alone, for example ask for `qa-report-builder` to rebuild the PDFs after a fresh test run.

## What you need to provide

- The base URL, and how to start the app if it is local.
- A **test** account if login is in scope. Never production credentials.
- Anything destructive to avoid.

The lead finds everything else from the repo. Tests are not run against production or real user data; a live third-party site is only tested with your explicit say-so and a read-only, low-volume scope.

## Rules the agents follow

- Every requirement gets at least a `@boundary` and an `@error` test, or a written, justified exemption.
- A failing test caused by a real app defect stays failing and is reported. Assertions are never weakened to get green.
- Application source code is not changed.
- Only one agent writes to any file. One runner at a time, because parallel runs on a live site cause flakiness.
- Anything automation cannot reach becomes a manual test in `manual/zephyr-import.csv`.

## Bug report workflow

1. The runner confirms a defect, then adds it to `qa/bugs/bugs.json`:

   ```json
   {
     "bugs": [{
       "id": "BUG-001",
       "title": "Very long URL path returns HTTP 500 instead of a 404",
       "severity": "medium",
       "test": "very long path",
       "summary": "What is wrong and why it matters.",
       "steps": ["Step 1 to recreate by hand.", "Step 2."],
       "expected": "A 4xx status and the normal not-found page.",
       "actual": "HTTP 500."
     }]
   }
   ```

   `test` is a unique part of the failing test title, used to attach screenshots and test data.
2. Serious and critical accessibility violations are added to the bug report automatically.
3. Failed tests not listed in `bugs.json` appear in an "Unconfirmed failures" section until triaged.

## Running without Claude

Everything the agents produce is plain files and npm scripts. From `<project>/qa/`:

```bash
npm install
npm run install:browsers
npm run test:all        # all suites, coverage check, all PDFs
```

Individual commands:

| Command | Does |
|---|---|
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run test:api` | API tests |
| `npm run test:unit` | Vitest with coverage thresholds |
| `npm run test:a11y` | Accessibility tests |
| `npm run coverage:check` | Coverage gate (fails on gaps) |
| `npm run scan:changes` | What changed since the baseline and which tests are needed (`-- --accept` records a new baseline) |
| `npm run report` | Functional report PDF |
| `npm run report:a11y` | Accessibility report PDF |
| `npm run report:bugs` | Bug report PDF |
| `npm run zephyr:export` | Regenerate the Zephyr Scale CSV |

Set `BASE_URL` to point at a different environment. See `qa/README.md` in the project for details.

## Importing manual tests into Zephyr Scale

Import `qa/manual/zephyr-import.csv` through Zephyr Scale's CSV import. The column mapping has not been checked against a real Zephyr instance, so if the import rejects it, adjust the mapping in the import dialog or fix `scripts/export-zephyr.ts`.

## Scanning for changes

After the first full run, record a baseline. From then on, scan for what changed and write only the missing tests:

```bash
npm run scan:changes              # report what changed and which tests are needed (exit 1 if any)
npm run scan:changes -- --accept  # after the new tests pass: record the new baseline
```

- **Codebases:** every source file under `sourceRoots` is hashed and compared with `coverage/baseline.json`. It reports new or unmapped code, modified code and the requirements it affects, deleted code, and changed UI files that need an accessibility re-scan.
- **Live sites (no source):** each matrix page is snapshotted (status, title, headings, landmarks, form fields, buttons, link count) and compared with the baseline. New top-level routes in the navigation are flagged.
- Output is `coverage/CHANGES.md` (human-readable) and `artifacts/change-report.json`.

With the agents: ask `qa-lead` to "scan for changes and update the tests". It runs `qa-change-scanner`, hands the grouped plan to `qa-spec-writer` agents (functional and accessibility tests for every change), runs everything, rebuilds the reports, and records the new baseline.

## Keeping coverage complete

On every later change, start the lead in update mode: it edits the matrix first, runs `npm run coverage:check`, and lets the failures define the work (uncovered requirements, missing boundary or error tests, unmapped source files, pages without accessibility tests), then re-runs everything and regenerates the PDFs.

## Known limitations

- The agent prompts have not yet been run end to end. The skill and scripts were exercised by hand on a live site (bbc.co.uk), but a full `qa-lead` run is untested.
- Live sites change layout (A/B variants, cookie banners), which can make locators fail; the runner triages these as test bugs.
- The `qa-spec-writer` agents must each own separate files; very small projects may not benefit from parallel spec writers.

## Where things live (after install)

| What | Path |
|---|---|
| Agent definitions | `~/.claude/agents/qa-*.md` |
| Skill (rules, scaffold, templates, references) | `~/.claude/skills/qa-playwright/` |
