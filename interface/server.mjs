#!/usr/bin/env node
// QA Agent Team interface: an MCP server (stdio) for Claude desktop plus a local
// dashboard. Zero dependencies, Node 18+.
//
//   node server.mjs            MCP over stdio, and the dashboard on 127.0.0.1:4747
//   node server.mjs --web      dashboard only (open it in a normal browser)
//
// Runs launch the real `qa-lead` agent via `claude -p` in the target project, as a
// detached process, so a run survives this server restarting. State lives in
// ~/.qa-agent-team-ui/runs/<id>/.

import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const STATE_DIR = process.env.QA_UI_STATE_DIR || path.join(HOME, '.qa-agent-team-ui');
const RUNS_DIR = path.join(STATE_DIR, 'runs');
const WORK_DIR = path.join(STATE_DIR, 'workspaces');
const PORT = Number(process.env.QA_UI_PORT || 4747);
const WEB_ONLY = process.argv.includes('--web');
const ALLOWED_TOOLS = process.env.QA_UI_ALLOWED_TOOLS || 'Bash,Read,Write,Edit,Glob,Grep,Agent,Skill';
const PERMISSION_MODE = process.env.QA_UI_PERMISSION_MODE || 'acceptEdits';

// Per-run settings. Values go onto the claude command line, so they are checked
// against an allowlist (or a strict pattern) rather than passed through.
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Runs default to Sonnet at low effort; pass 'default' to use Claude's own default instead.
const DEFAULT_MODEL = process.env.QA_UI_MODEL || 'sonnet';
const DEFAULT_EFFORT = process.env.QA_UI_EFFORT || 'low';
function cleanSettings({ model, effort, maxBudgetUsd } = {}) {
  const out = {};
  model = model || DEFAULT_MODEL; effort = effort || DEFAULT_EFFORT;
  if (model === 'default') model = '';
  if (effort === 'default') effort = '';
  if (model) {
    const m = String(model).trim();
    if (!MODEL_ALIASES.includes(m) && !/^claude-[a-z0-9.-]{1,60}$/.test(m)) throw new Error(`Unknown model "${m}". Use ${MODEL_ALIASES.join(', ')} or a full id like claude-sonnet-5-5.`);
    out.model = m;
  }
  if (effort) {
    if (!EFFORTS.includes(effort)) throw new Error(`Unknown effort "${effort}". Use ${EFFORTS.join(', ')}.`);
    out.effort = effort;
  }
  if (maxBudgetUsd !== undefined && maxBudgetUsd !== null && maxBudgetUsd !== '') {
    const n = Number(maxBudgetUsd);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error('Budget must be a number of dollars between 0 and 1000.');
    out.maxBudgetUsd = n;
  }
  return out;
}

fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

// ---------- locating the claude CLI ----------
function findClaude() {
  if (process.env.QA_UI_CLAUDE_BIN) return process.env.QA_UI_CLAUDE_BIN;
  const candidates = [
    path.join(HOME, '.local/bin/claude'),
    path.join(HOME, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'claude');
    if (dir && fs.existsSync(p)) return p;
  }
  return 'claude';
}
const CLAUDE_BIN = findClaude();

// true / false, or null when the CLI can't tell us (then we don't block the run).
function claudeLoggedIn() {
  try {
    const out = execFileSync(CLAUDE_BIN, ['auth', 'status'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(out);
    return typeof j.loggedIn === 'boolean' ? j.loggedIn : null;
  } catch (e) {
    // `auth status` may exit non-zero when logged out but still print JSON.
    try { const j = JSON.parse(e.stdout || ''); return typeof j.loggedIn === 'boolean' ? j.loggedIn : null; } catch { return null; }
  }
}

function agentsInstalled() {
  const dirs = [path.join(HOME, '.claude/agents')];
  return dirs.some((d) => fs.existsSync(path.join(d, 'qa-lead.md')));
}

// ---------- runs ----------
const isUrl = (s) => /^https?:\/\//i.test(s);
const slug = (s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'site';
const runDir = (id) => path.join(RUNS_DIR, id);
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

function newId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

function resolveTarget(target) {
  if (isUrl(target)) {
    const cwd = path.join(WORK_DIR, slug(target));
    fs.mkdirSync(cwd, { recursive: true });
    return { cwd, kind: 'site' };
  }
  const cwd = path.resolve(target.replace(/^~(?=$|\/)/, HOME));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Not a directory or URL: ${target}`);
  return { cwd, kind: 'project' };
}

function buildPrompt({ target, mode, notes, kind }) {
  const what = kind === 'site'
    ? `${target}. Read-only, no logins.`
    : `this project.`;
  const base = mode === 'update'
    ? 'Scan for changes and update the tests. Then run the suite and rebuild the reports.'
    : `QA ${what}`;
  return [base, notes].filter(Boolean).join(' ');
}

function startRun({ target, mode = 'full', notes = '', model, effort, maxBudgetUsd }) {
  if (!target) throw new Error('target is required (project path or URL)');
  if (!agentsInstalled()) throw new Error('qa-lead agent not found in ~/.claude/agents. Run ./install.sh from the repo root first.');
  if (claudeLoggedIn() === false) throw new Error(`Claude Code CLI is not logged in, so runs would fail immediately. Run "${CLAUDE_BIN} auth login" in a terminal, then try again.`);
  const settings = cleanSettings({ model, effort, maxBudgetUsd });
  const { cwd, kind } = resolveTarget(target);
  const id = newId();
  const dir = runDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const prompt = buildPrompt({ target, mode, notes, kind });
  const meta = { id, target, kind, mode, notes, settings, cwd, prompt, startedAt: new Date().toISOString(), cancelled: false };
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta, null, 2));

  const out = fs.openSync(path.join(dir, 'stream.jsonl'), 'a');
  const err = fs.openSync(path.join(dir, 'stderr.log'), 'a');
  const args = [
    '--agent', 'qa-lead', '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--permission-mode', PERMISSION_MODE,
    '--allowedTools', ALLOWED_TOOLS,
  ];
  if (settings.model) args.push('--model', settings.model);
  if (settings.effort) args.push('--effort', settings.effort);
  if (settings.maxBudgetUsd) args.push('--max-budget-usd', String(settings.maxBudgetUsd));
  // The wrapper records the exit code so status survives a server restart.
  const child = spawn('/bin/sh', ['-c', '"$@"; echo $? > "$QA_UI_EXIT_FILE"', 'sh', CLAUDE_BIN, ...args], {
    cwd,
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, QA_UI_EXIT_FILE: path.join(dir, 'exit') },
  });
  child.on('error', (e) => fs.writeFileSync(path.join(dir, 'exit'), `spawn-error: ${e.message}`));
  child.unref();
  meta.pid = child.pid;
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta, null, 2));
  return summarise(id);
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Incremental parse of the stream-json output, cached per run.
const parsers = new Map();
function parseStream(id) {
  const file = path.join(runDir(id), 'stream.jsonl');
  let st = parsers.get(id);
  if (!st) {
    st = { offset: 0, buf: '', agents: [], pending: new Map(), tools: 0, lastText: '', result: null, sessionId: null, timeline: [] };
    parsers.set(id, st);
  }
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return st; }
  if (size <= st.offset) return st;
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(size - st.offset);
  fs.readSync(fd, chunk, 0, chunk.length, st.offset);
  fs.closeSync(fd);
  st.offset = size;
  st.buf += chunk.toString('utf8');
  const lines = st.buf.split('\n');
  st.buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    applyEvent(st, ev);
  }
  return st;
}

function applyEvent(st, ev) {
  const at = new Date().toISOString();
  if (ev.type === 'system' && ev.subtype === 'init') st.sessionId = ev.session_id || null;
  if (ev.type === 'assistant' && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type === 'text' && c.text?.trim()) {
        if (!ev.parent_tool_use_id) st.lastText = c.text.trim();
      } else if (c.type === 'tool_use') {
        st.tools++;
        if ((c.name === 'Agent' || c.name === 'Task') && c.input) {
          const a = { id: c.id, agent: c.input.subagent_type || 'agent', description: c.input.description || '', status: 'running', startedAt: at };
          st.agents.push(a);
          st.pending.set(c.id, a);
          st.timeline.push({ at, kind: 'agent', text: `Started ${a.agent}${a.description ? ': ' + a.description : ''}` });
        } else if (!ev.parent_tool_use_id) {
          st.timeline.push({ at, kind: 'tool', text: `${c.name}${c.input?.command ? ': ' + String(c.input.command).slice(0, 120) : ''}` });
        }
      }
    }
  }
  if (ev.type === 'user' && ev.message?.content && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content) {
      if (c.type === 'tool_result' && st.pending.has(c.tool_use_id)) {
        const a = st.pending.get(c.tool_use_id);
        a.status = c.is_error ? 'failed' : 'done';
        a.endedAt = at;
        st.pending.delete(c.tool_use_id);
        st.timeline.push({ at, kind: 'agent', text: `${a.agent} ${a.status}` });
      }
    }
  }
  if (ev.type === 'result') {
    st.result = { text: ev.result || '', isError: !!ev.is_error, costUsd: ev.total_cost_usd ?? null, durationMs: ev.duration_ms ?? null, turns: ev.num_turns ?? null };
  }
  if (st.timeline.length > 400) st.timeline.splice(0, st.timeline.length - 400);
}

function summarise(id) {
  const dir = runDir(id);
  const meta = readJson(path.join(dir, 'run.json'));
  if (!meta) return null;
  const st = parseStream(id);
  let status = 'running';
  const exitRaw = fs.existsSync(path.join(dir, 'exit')) ? fs.readFileSync(path.join(dir, 'exit'), 'utf8').trim() : null;
  if (meta.cancelled) status = 'cancelled';
  else if (exitRaw !== null) status = exitRaw === '0' && !st.result?.isError ? 'succeeded' : 'failed';
  else if (meta.pid && !alive(meta.pid)) status = 'interrupted';
  let stderr = '';
  try { stderr = fs.readFileSync(path.join(dir, 'stderr.log'), 'utf8').slice(-1500); } catch {}
  return {
    id, status, target: meta.target, kind: meta.kind, mode: meta.mode, notes: meta.notes, settings: meta.settings || {}, cwd: meta.cwd,
    startedAt: meta.startedAt,
    agents: st.agents.map(({ agent, description, status: s }) => ({ agent, description, status: s })),
    toolCalls: st.tools,
    lastMessage: st.lastText.slice(-1500),
    result: st.result,
    error: status === 'failed' ? (st.result?.text || stderr || `exit ${exitRaw}`).slice(-1500) : undefined,
    reports: listReports(meta.cwd),
  };
}

function listRuns() {
  return fs.readdirSync(RUNS_DIR).filter((d) => fs.existsSync(path.join(RUNS_DIR, d, 'run.json'))).sort().reverse().map((id) => {
    const s = summarise(id);
    return { id: s.id, status: s.status, target: s.target, mode: s.mode, startedAt: s.startedAt, activeAgents: s.agents.filter((a) => a.status === 'running').map((a) => a.agent) };
  });
}

function cancelRun(id) {
  const meta = readJson(path.join(runDir(id), 'run.json'));
  if (!meta) throw new Error(`No such run: ${id}`);
  meta.cancelled = true;
  fs.writeFileSync(path.join(runDir(id), 'run.json'), JSON.stringify(meta, null, 2));
  if (meta.pid) { try { process.kill(-meta.pid, 'SIGTERM'); } catch { try { process.kill(meta.pid, 'SIGTERM'); } catch {} } }
  return summarise(id);
}

// ---------- reports ----------
const REPORT_DIRS = ['reports', 'manual', 'coverage', 'bugs'];
const REPORT_EXT = new Set(['.pdf', '.csv', '.md', '.json']);

function listReports(cwd) {
  const out = [];
  for (const sub of REPORT_DIRS) {
    const dir = path.join(cwd, 'qa', sub);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!REPORT_EXT.has(path.extname(n))) continue;
      const rel = `qa/${sub}/${n}`;
      try {
        const s = fs.statSync(path.join(cwd, rel));
        if (s.isFile()) out.push({ path: rel, bytes: s.size, modified: s.mtime.toISOString() });
      } catch {}
    }
  }
  return latestOnly(out);
}

// Reports are written as name-YYYY-MM-DD-HH-MM.ext plus a name-latest.ext copy.
// Show one file per report: the -latest copy if present, else the newest dated one.
function latestOnly(files) {
  const STAMP = /-(\d{4}-\d{2}-\d{2}(?:-\d{2}-\d{2})?)(\.\w+)$/;
  const families = new Map();
  const keep = [];
  for (const f of files) {
    const m = STAMP.exec(f.path);
    if (!m) { keep.push(f); continue; }
    const key = f.path.slice(0, m.index) + m[2];
    const cur = families.get(key);
    if (!cur || m[1] > cur.stamp) families.set(key, { stamp: m[1], f });
  }
  const latest = new Set(keep.map((f) => f.path));
  for (const [key, { f }] of families) {
    const alias = key.replace(/(\.\w+)$/, '-latest$1');
    if (!latest.has(alias)) keep.push(f);
  }
  return keep.sort((x, y) => x.path.localeCompare(y.path));
}

function coverageSummary(cwd) {
  const md = path.join(cwd, 'qa/coverage/COVERAGE.md');
  try { return fs.readFileSync(md, 'utf8').slice(0, 4000); } catch { return null; }
}

function bugSummary(cwd) {
  const j = readJson(path.join(cwd, 'qa/bugs/bugs.json'));
  const list = Array.isArray(j) ? j : j?.bugs;
  if (!Array.isArray(list)) return null;
  const bySeverity = {};
  for (const b of list) bySeverity[b.severity || 'unknown'] = (bySeverity[b.severity || 'unknown'] || 0) + 1;
  return { total: list.length, bySeverity };
}

// Only files inside <run cwd>/qa/<known dir>/ are ever served.
function resolveReportFile(id, rel) {
  const meta = readJson(path.join(runDir(id), 'run.json'));
  if (!meta) return null;
  const root = fs.realpathSync(meta.cwd);
  let full;
  try { full = fs.realpathSync(path.join(root, rel)); } catch { return null; }
  const allowed = REPORT_DIRS.some((d) => full.startsWith(path.join(root, 'qa', d) + path.sep));
  return allowed && REPORT_EXT.has(path.extname(full)) ? full : null;
}

// ---------- dashboard ----------
const MIME = { '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json' };
let dashboardUrl = null;

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

function handleHttp(req, res) {
  // Reject DNS-rebinding and cross-site requests: this server starts processes.
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return json(res, 403, { error: 'bad host' });
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(HERE, 'dashboard.html')));
  }
  if (req.method === 'GET' && p === '/api/health') {
    return json(res, 200, { agentsInstalled: agentsInstalled(), loggedIn: claudeLoggedIn(), claudeBin: CLAUDE_BIN, permissionMode: PERMISSION_MODE, allowedTools: ALLOWED_TOOLS });
  }
  if (req.method === 'GET' && p === '/api/runs') return json(res, 200, listRuns());
  let m;
  if (req.method === 'GET' && (m = p.match(/^\/api\/runs\/([\w-]+)$/))) {
    const s = summarise(m[1]);
    if (!s) return json(res, 404, { error: 'not found' });
    return json(res, 200, { ...s, timeline: parseStream(m[1]).timeline.slice(-120), coverage: coverageSummary(s.cwd), bugs: bugSummary(s.cwd) });
  }
  if (req.method === 'GET' && (m = p.match(/^\/api\/runs\/([\w-]+)\/file$/))) {
    const full = resolveReportFile(m[1], url.searchParams.get('path') || '');
    if (!full) return json(res, 404, { error: 'not found' });
    const disposition = url.searchParams.get('download') === '1' ? `attachment; filename="${path.basename(full).replace(/[^\w.-]/g, '_')}"` : 'inline';
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'content-disposition': disposition });
    return fs.createReadStream(full).pipe(res);
  }
  if (req.method === 'POST') {
    if (req.headers['x-qa-ui'] !== '1' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (p === '/api/runs') {
      return readBody(req).then((b) => json(res, 200, startRun(b))).catch((e) => json(res, 400, { error: e.message }));
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/cancel$/))) {
      try { return json(res, 200, cancelRun(m[1])); } catch (e) { return json(res, 404, { error: e.message }); }
    }
  }
  json(res, 404, { error: 'not found' });
}

function startDashboard() {
  return new Promise((resolve) => {
    const srv = http.createServer(handleHttp);
    srv.on('error', (e) => {
      // Another instance already owns the port: share its dashboard.
      dashboardUrl = e.code === 'EADDRINUSE' ? `http://127.0.0.1:${PORT}` : null;
      resolve(dashboardUrl);
    });
    srv.listen(PORT, '127.0.0.1', () => { dashboardUrl = `http://127.0.0.1:${PORT}`; resolve(dashboardUrl); });
  });
}

// ---------- MCP (JSON-RPC over stdio) ----------
const TOOLS = [
  {
    name: 'qa_run',
    description: 'Start a QA run with the qa-lead agent team on a project folder or a live site URL. Returns immediately with a run id; the run takes minutes to hours. Use qa_status to follow it.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Absolute path to a project folder, or an http(s) URL for a live site.' },
        mode: { type: 'string', enum: ['full', 'update'], description: 'full = plan, write, run and report from scratch. update = scan for changes and write only missing tests. Default full.' },
        model: { type: 'string', description: 'Optional model for the whole team (sub-agents inherit it): opus, sonnet, haiku, fable, or a full id such as claude-sonnet-5-5. Defaults to sonnet; pass "default" for Claude\'s own default.' },
        effort: { type: 'string', enum: [...EFFORTS, 'default'], description: 'Optional reasoning effort. Defaults to low; higher is slower and costs more. "default" uses Claude\'s own default.' },
        maxBudgetUsd: { type: 'number', description: 'Optional spending cap in US dollars. The run stops when it is reached.' },
        notes: { type: 'string', description: 'Extra instructions, e.g. "It runs at http://localhost:3000, start it with npm run dev" or test login details (never a real password).' },
      },
      required: ['target'],
    },
  },
  {
    name: 'qa_status',
    description: 'Progress of a QA run: status, which agents are active or done, latest message, final result, bug counts and report files. Omit run_id for the most recent run.',
    inputSchema: { type: 'object', properties: { run_id: { type: 'string' } } },
  },
  { name: 'qa_list_runs', description: 'List recent QA runs, newest first.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'qa_cancel',
    description: 'Stop a running QA run.',
    inputSchema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] },
  },
  {
    name: 'qa_reports',
    description: 'List the report files (PDFs, Zephyr CSV, coverage, bugs) in a project\'s qa/ folder, with the coverage summary and bug counts. Takes a project path or a run id.',
    inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, run_id: { type: 'string' } } },
  },
  { name: 'qa_open_dashboard', description: 'Get the URL of the live QA dashboard (open it in the Claude desktop browser pane).', inputSchema: { type: 'object', properties: {} } },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }], ...(isError ? { isError: true } : {}) });
const latestId = () => listRuns()[0]?.id;

function callTool(name, a = {}) {
  switch (name) {
    case 'qa_run': {
      const s = startRun(a);
      return text({ started: true, run_id: s.id, status: s.status, working_dir: s.cwd, dashboard: dashboardUrl, next: 'Call qa_status with this run_id to follow progress.' });
    }
    case 'qa_status': {
      const id = a.run_id || latestId();
      if (!id) return text('No runs yet.');
      const s = summarise(id);
      if (!s) return text(`No such run: ${id}`, true);
      return text({ ...s, coverage: coverageSummary(s.cwd), bugs: bugSummary(s.cwd), dashboard: dashboardUrl });
    }
    case 'qa_list_runs': return text(listRuns());
    case 'qa_cancel': return text(cancelRun(a.run_id));
    case 'qa_reports': {
      const cwd = a.run_id ? readJson(path.join(runDir(a.run_id), 'run.json'))?.cwd : a.project_path && path.resolve(a.project_path.replace(/^~(?=$|\/)/, HOME));
      if (!cwd) return text('Give project_path or a valid run_id.', true);
      return text({ project: cwd, files: listReports(cwd).map((f) => ({ ...f, absolute: path.join(cwd, f.path) })), coverage: coverageSummary(cwd), bugs: bugSummary(cwd) });
    }
    case 'qa_open_dashboard':
      return text(dashboardUrl ? { url: dashboardUrl } : 'Dashboard is not running (port busy or --web not used).', !dashboardUrl);
    default: return text(`Unknown tool: ${name}`, true);
  }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function handleRpc(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'qa-agent-team', version: '0.1.0' },
        instructions: 'Control the qa-agent-team QA agents: start runs with qa_run, follow them with qa_status, fetch outputs with qa_reports. The dashboard URL from qa_open_dashboard shows live progress.',
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call':
      try { return reply(callTool(params.name, params.arguments)); } catch (e) { return reply(text(e.message, true)); }
    default:
      if (method?.startsWith('notifications/')) return;
      return fail(-32601, `Method not found: ${method}`);
  }
}

await startDashboard();

if (WEB_ONLY) {
  console.error(`QA dashboard: ${dashboardUrl ?? 'failed to start'}`);
} else {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { handleRpc(JSON.parse(line)); } catch (e) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }); }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
