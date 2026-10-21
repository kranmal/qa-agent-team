# Claude desktop interface

An MCP server plus a live dashboard for the QA agent team. Claude desktop can start runs, follow them and fetch the reports from chat, and the dashboard shows which agents are working.

It runs the real agents: each run launches `claude --agent qa-lead -p "..."` in the target project. The run is a detached process, so it survives the server or Claude desktop restarting. State is kept in `~/.qa-agent-team-ui/`.

## Requirements

- The agents installed (`./install.sh` from the repo root)
- Claude Code CLI on this machine, signed in
- Node.js 18+. There is nothing to `npm install`.

## Set up Claude desktop

```bash
node interface/setup.mjs            # prints the config entry
node interface/setup.mjs --write    # merges it into claude_desktop_config.json (backup first)
```

Restart Claude desktop. Then ask, for example:

- "Run QA on https://example.com"
- "Run QA on /Users/me/my-app. It runs at http://localhost:3000, start it with npm run dev."
- "How is the QA run going?"
- "Show me the QA reports" / "Open the QA dashboard"

## Tools

| Tool | What it does |
|---|---|
| `qa_run` | Start a full or update run on a project path or site URL. Returns a run id. |
| `qa_status` | Status, active and finished agents, latest message, bug counts, report files. |
| `qa_list_runs` | Recent runs. |
| `qa_cancel` | Stop a run. |
| `qa_reports` | The files in a project's `qa/` folder, with the coverage summary. |
| `qa_open_dashboard` | URL of the dashboard (`http://127.0.0.1:4747`). Open it in the Claude desktop browser pane. |

For a site URL the run works in `~/.qa-agent-team-ui/workspaces/<site>/`.

## Dashboard on its own

```bash
node interface/server.mjs --web
```

Open http://127.0.0.1:4747.

## Permissions

Runs are headless, so nobody can answer permission prompts. By default a run uses `--permission-mode acceptEdits` and pre-allows `Bash,Read,Write,Edit,Glob,Grep,Agent,Skill`. That means the agents can run shell commands in the target project without asking, which they need to install Playwright and run the tests. Only point it at projects you are happy for them to do that in. Tighten it with environment variables:

| Variable | Default |
|---|---|
| `QA_UI_ALLOWED_TOOLS` | `Bash,Read,Write,Edit,Glob,Grep,Agent,Skill` |
| `QA_UI_PERMISSION_MODE` | `acceptEdits` |
| `QA_UI_PORT` | `4747` |
| `QA_UI_CLAUDE_BIN` | auto-detected |
| `QA_UI_STATE_DIR` | `~/.qa-agent-team-ui` |

The dashboard listens on 127.0.0.1 only, rejects other Host and Origin headers, and requires a custom header on every POST. It serves only files under the project's `qa/reports`, `qa/manual`, `qa/coverage` and `qa/bugs`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Tools don't appear in Claude desktop | Re-run `setup.mjs --write` and restart the app. Check the entry exists in `claude_desktop_config.json`. |
| `qa-lead agent not found` | Run `./install.sh`. |
| `Claude Code CLI is not logged in` | Run `claude auth login` in a terminal. The CLI signs in separately from the desktop app. |
| Run fails straight away | Open the run in the dashboard and read the error. Usually `claude` isn't signed in or `QA_UI_CLAUDE_BIN` is wrong. |
| Dashboard port busy | Another instance owns it and is shared. Or set `QA_UI_PORT`. |
