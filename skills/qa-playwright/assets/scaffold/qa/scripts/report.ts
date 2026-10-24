/**
 * PDF report generator.
 *   tsx scripts/report.ts functional   -> reports/qa-report-<timestamp>.pdf  (+ qa-report-latest.pdf)
 *   tsx scripts/report.ts a11y         -> reports/a11y-report-<timestamp>.pdf (+ a11y-report-latest.pdf)
 * Reads artifacts/results-*.json (Playwright), artifacts/vitest.json, artifacts/coverage-report.json.
 * Renders HTML with screenshots embedded, then prints it to PDF with Playwright's Chromium.
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const QA = path.resolve(__dirname, '..');
const ART = path.join(QA, 'artifacts');
const mode = process.argv[2] === 'a11y' ? 'a11y' : process.argv[2] === 'bugs' ? 'bugs' : 'functional';

interface Attachment { name: string; contentType: string; path?: string }
interface Result {
  title: string; file: string; line: number; project: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  durationMs: number; tags: string[]; covers: string[]; error?: string; attachments: Attachment[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const readJson = (f: string) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined);
const read = (a: Attachment) => (a.path && fs.existsSync(a.path) ? fs.readFileSync(a.path) : undefined);
const SECRET = /pass(word)?|token|secret|api[-_]?key|authorization|cookie/i;

// ---------- load Playwright results ----------
function flatten(file: string): Result[] {
  const json = readJson(path.join(ART, file));
  if (!json) return [];
  const out: Result[] = [];
  const walk = (suite: any, trail: string[]) => {
    const t = suite.title && !/\.(spec|test)\.ts$/.test(suite.title) ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const r = test.results?.[test.results.length - 1] ?? {};
        const title = [...t, spec.title].join(' › ');
        out.push({
          title, file: spec.file, line: spec.line, project: test.projectName,
          status: test.status === 'expected' ? 'passed' : test.status === 'skipped' ? 'skipped' : test.status === 'flaky' ? 'flaky' : 'failed',
          durationMs: r.duration ?? 0,
          tags: [...new Set<string>([...(spec.tags ?? []).map((x: string) => x.replace(/^@/, '')), ...[...title.matchAll(/@(\w+)/g)].map((m) => m[1])])],
          covers: [...title.matchAll(/\[([A-Z][A-Z0-9]*-\d+)\]/g)].map((m) => m[1]),
          error: r.error?.message ?? r.errors?.[0]?.message,
          attachments: r.attachments ?? [],
        });
      }
    }
    for (const s of suite.suites ?? []) walk(s, t);
  };
  for (const s of json.suites ?? []) walk(s, []);
  return out;
}

// ---------- shared rendering ----------
const CSS = `
  *{box-sizing:border-box} body{font:10.5px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433;margin:0}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:16px;margin:22px 0 8px;border-bottom:2px solid #1d2433;padding-bottom:3px}
  h3{font-size:12.5px;margin:0} h4{font-size:10.5px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:#556}
  .cover{padding:80px 0 30px} .muted{color:#667} .grid{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
  .card{border:1px solid #d5d9e2;border-radius:6px;padding:8px 14px;min-width:90px} .card b{display:block;font-size:20px}
  table{border-collapse:collapse;width:100%;margin:4px 0 8px} th,td{border:1px solid #d5d9e2;padding:3px 6px;text-align:left;vertical-align:top}
  th{background:#eef0f5} td.k{width:28%;font-weight:600;background:#fafbfc} code,pre{font:9.5px ui-monospace,Menlo,monospace}
  pre{background:#f5f6f9;padding:6px;border-radius:4px;white-space:pre-wrap;word-break:break-word;margin:4px 0}
  .test{border:1px solid #d5d9e2;border-radius:6px;padding:10px 12px;margin:12px 0}
  .badge{display:inline-block;border-radius:10px;padding:1px 8px;font-weight:700;font-size:9.5px;color:#fff}
  .passed{background:#1a7f37}.failed{background:#cf222e}.skipped{background:#6e7781}.flaky{background:#bf8700}
  .critical{background:#82071e}.serious{background:#cf222e}.moderate{background:#bf8700}.minor{background:#0969da}
  .tag{display:inline-block;background:#eef0f5;border-radius:4px;padding:0 5px;margin-right:3px;font-size:9.5px}
  .step{break-inside:avoid;margin:6px 0} .step img{width:100%;border:1px solid #d5d9e2;border-radius:4px}
  .err{color:#cf222e} .pb{page-break-before:always}
  .band{background:#0b1f3a;color:#fff;border-radius:8px;padding:34px 36px;margin:0 0 14px} .band h1{font-size:30px;color:#fff;margin:0 0 6px}
  .band .muted{color:#b8c4d9} .band .eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:9.5px;color:#7fb2ff;margin-bottom:10px}
  .grid .card{background:#f7f8fb} .card .lbl{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:#556}
  .bar{display:flex;height:12px;border-radius:6px;overflow:hidden;margin:8px 0 2px;background:#eef0f5} .bar i{display:block;height:100%}
  .legend span{margin-right:12px} .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
  .kind{display:inline-block;border-radius:4px;padding:1px 7px;font-weight:700;font-size:9.5px;letter-spacing:.03em;color:#fff;text-transform:uppercase}
  .k-happy{background:#0969da}.k-boundary{background:#6f42c1}.k-error{background:#bc4c00}.k-a11y{background:#1a7f37}
  .test.t-boundary{border-left:5px solid #6f42c1}.test.t-error{border-left:5px solid #bc4c00}.test.t-happy{border-left:5px solid #0969da}.test.t-a11y{border-left:5px solid #1a7f37}
  .intro{background:#f7f8fb;border-left:4px solid #6f42c1;padding:8px 12px;margin:6px 0 10px;border-radius:0 6px 6px 0}
  .intro.e{border-left-color:#bc4c00} a.tl{color:#0b57d0;text-decoration:underline} a.back{float:right;font-size:9px;font-weight:400;color:#57606a;text-decoration:none} td.data{font:9px ui-monospace,Menlo,monospace;color:#334} .ok{color:#1a7f37;font-weight:700} .zero{color:#cf222e;font-weight:700}
  .toc td{border:none;padding:2px 6px}
`;
const badge = (s: string) => `<span class="badge ${esc(s)}">${esc(s.toUpperCase())}</span>`;
const tags = (t: string[]) => t.map((x) => `<span class="tag">@${esc(x)}</span>`).join('');

function git(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: path.join(QA, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'n/a'; }
}
function projectName(): string {
  return readJson(path.join(QA, 'coverage', 'coverage-matrix.json'))?.project ?? path.basename(path.resolve(QA, '..'));
}
const kindOf = (r: Result) => (r.project === 'a11y' ? 'a11y' : r.tags.includes('boundary') ? 'boundary' : r.tags.includes('error') ? 'error' : 'happy');
const KIND_LABEL: Record<string, string> = { happy: 'Happy path', boundary: 'Boundary', error: 'Error handling', a11y: 'Accessibility' };
const kindChip = (k: string) => `<span class="kind k-${k}">${esc(KIND_LABEL[k] ?? k)}</span>`;
const cover = (title: string, stats: [string, string | number][], pass?: { passed: number; failed: number; flaky: number; skipped: number }) => {
  const total = pass ? pass.passed + pass.failed + pass.flaky + pass.skipped : 0;
  const seg = (n: number, c: string) => (total ? `<i style="width:${(n / total) * 100}%;background:${c}"></i>` : '');
  return `
  <div class="band"><div class="eyebrow">Quality assurance report</div><h1>${esc(title)}</h1>
  <div class="muted">${esc(projectName())} &nbsp;·&nbsp; target ${esc((readJson(path.join(ART, 'run-info.json'))?.baseURL ?? process.env.BASE_URL ?? 'unknown'))}</div>
  <div class="muted">Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; commit ${esc(git())}</div></div>
  <div class="grid">${stats.map(([k, v]) => `<div class="card"><span class="lbl">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
  ${pass ? `<div class="bar">${seg(pass.passed, '#1a7f37')}${seg(pass.flaky, '#bf8700')}${seg(pass.failed, '#cf222e')}${seg(pass.skipped, '#6e7781')}</div>
  <div class="legend muted"><span><i class="dot" style="background:#1a7f37"></i>Passed ${pass.passed}</span><span><i class="dot" style="background:#bf8700"></i>Flaky ${pass.flaky}</span><span><i class="dot" style="background:#cf222e"></i>Failed ${pass.failed}</span><span><i class="dot" style="background:#6e7781"></i>Skipped ${pass.skipped}</span></div>` : ''}`;
};
const dataSummary = (r: Result) => {
  const a = r.attachments.find((x) => x.name === 'test-data'); const buf = a && read(a);
  if (!buf) return '-';
  try { return flat(JSON.parse(buf.toString())).map(([k, v]) => `${k}: ${v}`).join('  |  '); } catch { return '-'; }
};

function flat(obj: unknown, prefix = ''): [string, string][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, SECRET.test(k) ? '••••••' : typeof v === 'string' ? v : JSON.stringify(v)] as [string, string]]);
  }
  return [[prefix || 'value', JSON.stringify(obj)]];
}
const dataTable = (a?: Attachment) => {
  const buf = a && read(a);
  if (!buf) return '<p class="muted">No test data recorded.</p>';
  return `<table>${flat(JSON.parse(buf.toString())).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
};
const label = (a: Attachment) => a.name.split(':').slice(2).join(':');
const images = (r: Result) => r.attachments.filter((a) => a.name.startsWith('step:'));
const evidences = (r: Result) => r.attachments.filter((a) => a.name.startsWith('evidence:'));

const stepsHtml = (r: Result) => {
  const steps = r.attachments.filter((a) => /^(step|evidence):/.test(a.name));
  if (!steps.length) return '<p class="muted">No step evidence recorded.</p>';
  return steps.map((a, i) => {
    const buf = read(a);
    if (!buf) return '';
    if (a.name.startsWith('step:')) {
      return `<div class="step"><b>Step ${i + 1}: ${esc(label(a))}</b><br><img src="data:${a.contentType || 'image/png'};base64,${buf.toString('base64')}"></div>`;
    }
    const txt = JSON.stringify(JSON.parse(buf.toString()), (k, v) => (SECRET.test(k) ? '••••••' : v), 2);
    return `<div class="step"><b>Step ${i + 1}: ${esc(label(a))}</b><pre>${esc(txt.length > 3500 ? txt.slice(0, 3500) + '\n… (truncated)' : txt)}</pre></div>`;
  }).join('');
};

// Stable in-document anchor per test, so summary tables can link to its screenshots.
const anchors = new Map<Result, string>();
const anchor = (r: Result) => {
  let id = anchors.get(r);
  if (!id) { id = `t-${anchors.size + 1}-${`${r.project}-${r.file}-${r.line}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`; anchors.set(r, id); }
  return id;
};
const link = (r: Result, text: string) => `<a class="tl" href="#${anchor(r)}">${text}</a>`;

const testBlock = (r: Result, extra = '') => `
  <div class="test t-${kindOf(r)}" id="${anchor(r)}"><h3>${kindChip(kindOf(r))} ${badge(r.status)} ${esc(r.title.replace(/\[[A-Z0-9-]+\]\s*/, '').replace(/@\w+\s*/g, ''))} <a class="back" href="#top">↑ top</a></h3>
  <div class="muted">Requirement <b>${esc(r.covers.join(', ') || '-')}</b> · ${esc(r.project)} · ${esc(r.file)}:${r.line} · ${(r.durationMs / 1000).toFixed(1)}s ${tags(r.tags)}</div>
  ${r.error ? `<pre class="err">${esc(r.error.slice(0, 1500))}</pre>` : ''}
  <h4>Test data used</h4>${dataTable(r.attachments.find((a) => a.name === 'test-data'))}
  ${extra}<h4>Steps and screenshots</h4>${stepsHtml(r)}</div>`;

// Boundary + error-handling assurance: what was tried, with which data, and what happened.
function assuranceHtml(results: Result[], cov: any): string {
  const by = (k: string) => results.filter((r) => kindOf(r) === k);
  const stat = (set: Result[]) => ({ n: set.length, p: set.filter((r) => r.status === 'passed' || r.status === 'flaky').length, f: set.filter((r) => r.status === 'failed').length });
  const row = (label: string, k: string, why: string) => { const t = stat(by(k)); return `<tr><td>${kindChip(k)}</td><td>${why}</td><td>${t.n}</td><td class="ok">${t.p}</td><td class="${t.f ? 'zero' : ''}">${t.f}</td></tr>`; };
  let h = `<h2 class="pb">Boundary testing and error handling</h2>
  <div class="intro"><b>Boundary testing</b> checks the edges of every input and limit: empty, smallest, largest, one past the limit, special characters, unicode, and screen sizes.
  <br><b>Error handling</b> checks that bad input, missing pages and failing services produce a clear, safe outcome rather than a crash or a server error.</div>
  <table><tr><th>Type of test</th><th>What it proves</th><th>Tests</th><th>Passed</th><th>Failed</th></tr>
  ${row('Happy path', 'happy', 'The normal journey works')}${row('Boundary', 'boundary', 'Limits and edge values are handled')}${row('Error handling', 'error', 'Failures are handled safely and clearly')}</table>`;
  const reqs: any[] = cov?.rows ?? [];
  if (reqs.length) {
    const cell = (id: string, k: string, exempt: boolean, manual = false) => { if (manual) return '<span class="muted">manual (Zephyr)</span>'; const t = stat(results.filter((r) => r.covers.includes(id) && kindOf(r) === k));
      return t.n ? `<span class="${t.f ? 'zero' : 'ok'}">${t.p}/${t.n} passed</span>` : exempt ? '<span class="muted">n/a (exempt)</span>' : '<span class="zero">none</span>'; };
    const matrix = readJson(path.join(QA, 'coverage', 'coverage-matrix.json'))?.requirements ?? [];
    h += `<h3 style="margin-top:14px">Per requirement</h3><table><tr><th>Requirement</th><th>Happy path</th><th>Boundary</th><th>Error handling</th></tr>${reqs.map((q) => {
      const ex = matrix.find((m: any) => m.id === q.id)?.exemptions ?? {};
      return `<tr><td><b>${esc(q.id)}</b> ${esc(q.description)}</td><td>${cell(q.id, 'happy', false, q.status === 'manual')}</td><td>${cell(q.id, 'boundary', !!ex.boundary, q.status === 'manual')}</td><td>${cell(q.id, 'error', !!ex.error, q.status === 'manual')}</td></tr>`; }).join('')}</table>`;
  }
  for (const [k, title, cls] of [['boundary', 'Boundary tests - data and outcome', ''], ['error', 'Error-handling tests - data and outcome', 'e']] as const) {
    const set = by(k);
    h += `<h3 style="margin-top:16px">${title}</h3>` + (set.length ? `<table><tr><th>Result</th><th>Req</th><th>Test</th><th>Data used</th></tr>${set.map((r) =>
      `<tr><td>${badge(r.status)}</td><td>${esc(r.covers.join(', '))}</td><td>${link(r, esc(r.title.replace(/\[[A-Z0-9-]+\]\s*/, '').replace(/@\w+\s*/g, '')))}</td><td class="data">${esc(dataSummary(r))}</td></tr>`).join('')}</table>` : '<p class="muted">None.</p>');
  }
  return h;
}

// ---------- functional report ----------
// Coverage percentages: how much of the matrix the tests provide, with a bar per measure.
function coverageHtml(results: Result[], cov: any, passRate: number): string {
  if (!cov) return '';
  const sm = cov.summary, rows: any[] = cov.rows;
  const matrix = readJson(path.join(QA, 'coverage', 'coverage-matrix.json')) ?? {};
  const ex = (id: string) => matrix.requirements?.find((m: any) => m.id === id)?.exemptions ?? {};
  const auto = rows.filter((r) => r.status === 'automated');
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 100);
  const m: [string, number, string][] = [
    ['Requirements covered (automated + manual)', pct(sm.total - sm.uncovered, sm.total), `${sm.total - sm.uncovered} of ${sm.total}`],
    ['Requirements automated', pct(sm.automated, sm.total), `${sm.automated} of ${sm.total} (${sm.manualOnly} manual-only in Zephyr)`],
    ['Boundary testing (automated requirements)', pct(auto.filter((r) => r.tags.includes('boundary') || ex(r.id).boundary).length, auto.length), `${auto.filter((r) => r.tags.includes('boundary')).length} tested, rest justified exemptions`],
    ['Error handling (automated requirements)', pct(auto.filter((r) => r.tags.includes('error') || ex(r.id).error).length, auto.length), `${auto.filter((r) => r.tags.includes('error')).length} tested, rest justified exemptions`],
    ['Fully compliant requirements', pct(sm.fullyCompliant, sm.total), `${sm.fullyCompliant} of ${sm.total}`],
    ['Pages with an accessibility test', pct(sm.pagesTotal - sm.pagesWithoutA11yTest.length, sm.pagesTotal), `${sm.pagesTotal - sm.pagesWithoutA11yTest.length} of ${sm.pagesTotal}`],
    ['Test pass rate', passRate, 'of executed tests'],
  ];
  const us = readJson(path.join(ART, 'unit-coverage', 'coverage-summary.json'))?.total?.lines;
  const hasCode = (matrix.sourceRoots ?? []).length > 0 && us && typeof us.pct === 'number';
  m.push(['Source code line coverage (unit)', hasCode ? us.pct : -1, hasCode ? `${us.covered} of ${us.total} lines` : 'n/a: black-box run, no source code available']);
  const col = (p: number) => (p >= 90 ? '#1a7f37' : p >= 70 ? '#bf8700' : '#cf222e');
  return `<h2>Test coverage</h2><table><tr><th>Measure</th><th style="width:34%">Coverage</th><th>%</th><th>Detail</th></tr>${m.map(([k, p, d]) => p < 0
    ? `<tr><td>${esc(k)}</td><td></td><td class="muted">n/a</td><td class="muted">${esc(d)}</td></tr>`
    : `<tr><td>${esc(k)}</td><td><div class="bar" style="margin:2px 0"><i style="width:${p}%;background:${col(p)}"></i></div></td><td><b>${p}%</b></td><td class="muted">${esc(d)}</td></tr>`).join('')}</table>`;
}

// Manual Zephyr Scale tests for anything automation cannot reach (also exported to manual/zephyr-import.csv).
function manualHtml(): string {
  const tests: any[] = readJson(path.join(QA, 'manual', 'manual-tests.json'))?.tests ?? [];
  if (!tests.length) return '';
  return `<h2 class="pb">Manual tests (Zephyr Scale)</h2><p class="muted">${tests.length} manual tests cover what automation cannot reach. Import <b>manual/zephyr-import.csv</b> into Zephyr Scale. These are not executed by this run.</p>` +
    tests.map((t) => `<div class="test t-happy"><h3>${esc(t.id)} ${esc(t.name)}</h3>
    <div class="muted">Covers ${esc((t.covers ?? []).join(', '))} · ${esc(t.priority)} · ${esc(t.folder)}</div>
    <p><b>Objective:</b> ${esc(t.objective)}<br><b>Why manual:</b> ${esc(t.reason ?? '-')}<br><b>Precondition:</b> ${esc(t.precondition ?? '-')}</p>
    <table><tr><th>#</th><th>Step</th><th>Test data</th><th>Expected result</th></tr>${(t.steps ?? []).map((st: any, i: number) =>
      `<tr><td>${i + 1}</td><td>${esc(st.step)}</td><td>${esc(st.data ?? '-')}</td><td>${esc(st.expected)}</td></tr>`).join('')}</table></div>`).join('');
}

function functionalHtml(): string {
  const results = [...flatten('results-e2e.json'), ...flatten('results-api.json')];
  const vitest = readJson(path.join(ART, 'vitest.json'));
  const unit: { title: string; status: string; ms: number; file: string }[] =
    (vitest?.testResults ?? []).flatMap((f: any) => (f.assertionResults ?? []).map((a: any) => ({
      title: a.fullName ?? a.title, status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped', ms: a.duration ?? 0, file: path.relative(QA, f.name),
    })));
  const all = [...results.map((r) => r.status), ...unit.map((u) => u.status)];
  const count = (s: string) => all.filter((x) => x === s).length;
  const cov = readJson(path.join(ART, 'coverage-report.json'));
  const kinds = ['boundary', 'error', 'blackbox', 'whitebox', 'happy'].map((k) => [`@${k}`, results.filter((r) => r.tags.includes(k)).length + unit.filter((u) => u.title.includes(`@${k}`)).length] as [string, number]);

  let html = cover('Test Execution Report', [
    ['Total', all.length], ['Passed', count('passed')], ['Failed', count('failed')], ['Skipped', count('skipped')], ['Flaky', count('flaky')],
    ...(cov ? ([['Requirement coverage', `${cov.summary.coveragePct}%`], ['Automated', `${Math.round((cov.summary.automated / cov.summary.total) * 100)}%`]] as [string, string][]) : []), ...kinds,
  ], { passed: count('passed'), failed: count('failed'), flaky: count('flaky'), skipped: count('skipped') });
  html += coverageHtml(results, cov, Math.round((all.filter((x) => x === 'passed' || x === 'flaky').length / Math.max(all.length, 1)) * 1000) / 10);
  html += assuranceHtml(results, cov);
  if (cov) {
    html += `<h2>Coverage by requirement</h2><table><tr><th>ID</th><th>Area</th><th>Requirement</th><th>Status</th><th>Levels</th><th>Manual</th><th>Gaps</th></tr>${cov.rows.map((r: any) =>
      `<tr><td>${esc(r.id)}</td><td>${esc(r.area)}</td><td>${esc(r.description)}</td><td>${esc(r.status)}</td><td>${esc(r.levels.join(', ') || '-')}</td><td>${esc(r.manual.join(', ') || '-')}</td><td class="${r.gaps.length ? 'err' : ''}">${esc(r.gaps.join('; ') || '-')}</td></tr>`).join('')}</table>`;
    if (cov.summary.unmappedSourceFiles.length) html += `<p class="err">Unmapped source files: ${cov.summary.unmappedSourceFiles.map(esc).join(', ')}</p>`;
  }
  html += `<h2>Results summary</h2><table><tr><th>Status</th><th>Kind</th><th>Level</th><th>Test</th><th>Covers</th><th>Time</th></tr>${[
    ...results.map((r) => `<tr><td>${badge(r.status)}</td><td>${kindChip(kindOf(r))}</td><td>${esc(r.project)}</td><td>${link(r, esc(r.title))}</td><td>${esc(r.covers.join(', '))}</td><td>${(r.durationMs / 1000).toFixed(1)}s</td></tr>`),
    ...unit.map((u) => `<tr><td>${badge(u.status)}</td><td></td><td>unit</td><td>${esc(u.title)}</td><td></td><td>${(u.ms / 1000).toFixed(2)}s</td></tr>`),
  ].join('')}</table>`;
  for (const project of ['e2e', 'api']) {
    const set = results.filter((r) => r.project === project);
    if (set.length) html += `<h2 class="pb">${project === 'e2e' ? 'End-to-end tests' : 'API tests'} - detail</h2>${set.map((r) => testBlock(r)).join('')}`;
  }
  if (unit.length) html += `<h2 class="pb">Unit (white-box) tests</h2><p class="muted">Unit tests have no UI; each shows its pass/fail result and the assertions run.</p>`;
  html += manualHtml();
  return html;
}

// ---------- accessibility report ----------
function a11yHtml(): string {
  const results = flatten('results-a11y.json');
  if (!results.length) throw new Error('artifacts/results-a11y.json not found or empty - run `npm run test:a11y` first');
  const scans = results.flatMap((r) => r.attachments.filter((a) => a.name.startsWith('axe:')).map((a) => ({ r, name: label(a), res: JSON.parse(read(a)?.toString() ?? '{}') })));
  const impacts = ['critical', 'serious', 'moderate', 'minor'];
  const violations = scans.flatMap((s) => (s.res.violations ?? []).map((v: any) => ({ ...v, page: s.name, url: s.res.url })));
  const byImpact = (i: string) => violations.filter((v: any) => v.impact === i).length;
  const rules = new Map<string, any>();
  for (const v of violations) rules.set(v.id, { ...v, count: (rules.get(v.id)?.count ?? 0) + v.nodes.length });

  const covA = readJson(path.join(ART, 'coverage-report.json'))?.summary;
  const pagePct = covA ? Math.round(((covA.pagesTotal - covA.pagesWithoutA11yTest.length) / Math.max(covA.pagesTotal, 1)) * 100) : null;
  let html = cover('Accessibility Test Report', [
    ...(pagePct === null ? [] : ([['Page coverage', `${pagePct}%`]] as [string, string][])), ['Pages / states scanned', scans.length], ['Tests', results.length], ['Failed', results.filter((r) => r.status === 'failed').length],
    ...impacts.map((i) => [i, byImpact(i)] as [string, number]),
  ]);
  html += `<p class="muted">Standard: WCAG 2.2 AA (axe-core tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) plus axe best practices, run via
    <code>@axe-core/playwright</code> per <code>playwright.dev/docs/accessibility-testing</code>. Automated scanning finds only a portion of issues; see the manual accessibility checks in Zephyr Scale.</p>`;
  html += `<h2>Violations by rule</h2>${rules.size ? `<table><tr><th>Rule</th><th>Impact</th><th>Elements</th><th>Description</th><th>WCAG / tags</th></tr>${[...rules.values()].sort((a, b) => impacts.indexOf(a.impact) - impacts.indexOf(b.impact)).map((v) =>
    `<tr><td>${esc(v.id)}<br><a href="${esc(v.helpUrl)}">help</a></td><td>${badge(v.impact)}</td><td>${v.count}</td><td>${esc(v.help)}</td><td>${esc((v.tags ?? []).filter((t: string) => /wcag|best/.test(t)).join(', '))}</td></tr>`).join('')}</table>` : '<p>No violations found.</p>'}`;
  html += `<h2>Per page / state</h2><table><tr><th>Page / state</th><th>URL</th><th>Violations</th><th>Passed rules</th><th>Needs manual review</th></tr>${scans.map((s) =>
    `<tr><td>${link(s.r, esc(s.name))}</td><td>${esc(s.res.url)}</td><td class="${(s.res.violations ?? []).length ? 'err' : ''}">${(s.res.violations ?? []).length}</td><td>${(s.res.passes ?? []).length}</td><td>${(s.res.incomplete ?? []).length}</td></tr>`).join('')}</table>`;
  html += `<h2 class="pb">Detail</h2>` + results.map((r) => {
    const sc = scans.filter((s) => s.r === r);
    const detail = sc.map((s) => (s.res.violations ?? []).map((v: any) => `
      <h4>${badge(v.impact)} ${esc(v.id)} - ${esc(s.name)}</h4><p>${esc(v.description)} <a href="${esc(v.helpUrl)}">${esc(v.helpUrl)}</a></p>
      <table><tr><th>Element</th><th>HTML</th><th>Fix</th></tr>${v.nodes.slice(0, 8).map((n: any) =>
        `<tr><td><code>${esc((n.target ?? []).join(' '))}</code></td><td><code>${esc((n.html ?? '').slice(0, 200))}</code></td><td>${esc((n.failureSummary ?? '').replace(/^Fix (any|all) of the following:\s*/, ''))}</td></tr>`).join('')}
      ${v.nodes.length > 8 ? `<tr><td colspan="3">… and ${v.nodes.length - 8} more</td></tr>` : ''}</table>`).join('')).join('');
    return testBlock(r, detail);
  }).join('');
  return html;
}

// ---------- bug report ----------
// bugs/bugs.json holds confirmed app defects (written by the triage step); failures not listed there are shown as unconfirmed.
const SEV = ['critical', 'high', 'medium', 'low'];
function bugsHtml(): string {
  const results = [...flatten('results-e2e.json'), ...flatten('results-api.json'), ...flatten('results-a11y.json')];
  const listed: any[] = readJson(path.join(QA, 'bugs', 'bugs.json'))?.bugs ?? [];
  const baseURL = readJson(path.join(ART, 'run-info.json'))?.baseURL ?? process.env.BASE_URL ?? 'unknown';
  const repro = (r: Result, own?: string[]) => {
    if (own?.length) { const data = r.attachments.find((a) => a.name === 'test-data'); return `<ol>${own.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${data ? `<h4>Test data</h4>${dataTable(data)}` : ''}`; }
    const steps = images(r).map(label);
    const data = r.attachments.find((a) => a.name === 'test-data');
    return `<ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>See the test steps in the QA report.</li>'}</ol>${data ? `<h4>Test data</h4>${dataTable(data)}` : ''}`;
  };
  const block = (id: string, sev: string, title: string, r: Result | undefined, summary: string, expected: string, actual: string, confirmed: boolean, own?: string[]) => `
    <div class="test t-error pb" id="bug-${esc(id)}"><h3><span class="kind k-error">${esc(id)}</span> <span class="badge ${esc(sev === 'critical' || sev === 'high' ? 'failed' : 'flaky')}">${esc(sev.toUpperCase())}</span> ${esc(title)}</h3>
    <div class="muted">${confirmed ? 'Confirmed app defect' : 'Unconfirmed: needs triage (may be a test issue)'} · ${r ? `Requirement ${esc(r.covers.join(', ') || '-')} · test ${esc(r.file)}:${r.line}` : ''} · Environment: Chromium 1280x800, ${esc(baseURL)}</div>
    <h4>Description</h4><p>${esc(summary)}</p>
    <h4>How to recreate</h4>${r ? repro(r, own) : '<p>See the evidence below.</p>'}
    <table><tr><th style="width:50%">Expected</th><th>Actual</th></tr><tr><td>${esc(expected)}</td><td class="err">${esc(actual)}</td></tr></table>
    ${r?.error ? `<h4>Test failure message</h4><pre class="err">${esc(r.error.slice(0, 900))}</pre>` : ''}
    ${r ? `<h4>Screenshots and evidence</h4>${stepsHtml(r)}` : ''}</div>`;
  const used = new Set<Result>();
  let html = '';
  const confirmed = listed.map((b) => { const r = results.find((x) => x.title.includes(b.test ?? b.id)); if (r) used.add(r); return { b, r }; })
    .sort((a, c) => SEV.indexOf(a.b.severity) - SEV.indexOf(c.b.severity));
  // serious/critical accessibility violations become bugs automatically
  const a11y = results.filter((r) => r.project === 'a11y').flatMap((r) => r.attachments.filter((a) => a.name.startsWith('axe:')).map((a) => ({ r, res: JSON.parse(read(a)?.toString() ?? '{}'), page: label(a) })));
  const byRule = new Map<string, any>();
  for (const x of a11y) for (const v of x.res.violations ?? []) if (v.impact === 'critical' || v.impact === 'serious') {
    const e = byRule.get(v.id) ?? { v, pages: [] as string[], r: x.r, nodes: [] as string[] };
    e.pages.push(x.page); e.nodes.push(...v.nodes.slice(0, 2).map((n: any) => n.target.join(' ')));
    byRule.set(v.id, e);
  }
  const unconfirmed = results.filter((r) => r.status === 'failed' && !used.has(r) && r.project !== 'a11y');
  const total = confirmed.length + byRule.size;
  html += cover('Bug Report', [['Confirmed defects', confirmed.length], ['Accessibility defects', byRule.size], ['Unconfirmed failures', unconfirmed.length],
    ...SEV.map((s) => [s, confirmed.filter((c) => c.b.severity === s).length] as [string, number])]);
  html += `<h2>Summary</h2><table><tr><th>ID</th><th>Severity</th><th>Defect</th><th>Type</th></tr>${confirmed.map((c) => `<tr><td><a class="tl" href="#bug-${esc(c.b.id)}">${esc(c.b.id)}</a></td><td>${esc(c.b.severity)}</td><td>${esc(c.b.title)}</td><td>Functional</td></tr>`).join('')}${[...byRule.values()].map((e, i) =>
    `<tr><td>A11Y-BUG-${String(i + 1).padStart(2, '0')}</td><td>${esc(e.v.impact)}</td><td>${esc(e.v.help)} (${esc(e.v.id)})</td><td>Accessibility</td></tr>`).join('')}</table>`;
  if (!total) html += '<p class="muted">No confirmed defects in this run.</p>';
  html += confirmed.map((c) => block(c.b.id, c.b.severity, c.b.title, c.r, c.b.summary, c.b.expected, c.b.actual, true, c.b.steps)).join('');
  html += [...byRule.values()].map((e, i) => block(`A11Y-BUG-${String(i + 1).padStart(2, '0')}`, e.v.impact === 'critical' ? 'critical' : 'high', `${e.v.help} (${e.v.id})`, e.r,
    `${e.v.description}. Found on: ${[...new Set(e.pages)].join(', ')}. Example elements: ${[...new Set(e.nodes)].slice(0, 4).join('; ')}. Guidance: ${e.v.helpUrl}`,
    'The element meets WCAG and axe rule ' + e.v.id + '.', `axe reports a ${e.v.impact} violation.`, true, [`Open ${[...new Set(e.pages)].join(' / ')} on ${baseURL}.`, `Run the axe browser extension (or @axe-core/playwright) on the page.`, `Find rule ${e.v.id} in the results and inspect: ${[...new Set(e.nodes)].slice(0, 3).join('; ')}.`])).join('');
  if (unconfirmed.length) html += `<h2 class="pb">Unconfirmed failures (need triage)</h2><p class="muted">These tests failed but have not been confirmed as app defects. They may be test issues, for example a cookie banner or a layout variant. Add them to bugs/bugs.json once confirmed.</p>` +
    unconfirmed.map((r, i) => block(`UNCONFIRMED-${i + 1}`, 'medium', r.title, r, 'The test failed on all attempts. Cause not yet confirmed.', 'See test title.', 'See failure message.', false)).join('');
  return html;
}

// ---------- render ----------
(async () => {
  const body = mode === 'a11y' ? a11yHtml() : mode === 'bugs' ? bugsHtml() : functionalHtml();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body id="top">${body}</body></html>`;
  const outDir = path.join(QA, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const prefix = mode === 'a11y' ? 'a11y-report' : mode === 'bugs' ? 'bug-report' : 'qa-report';
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(path.join(ART, `report-${mode}.html`), html); // handy for debugging the layout
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const opts = { format: 'A4' as const, landscape: true, printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' }, displayHeaderFooter: true,
    headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#667"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' };
  await page.pdf({ ...opts, path: path.join(outDir, `${prefix}-${stamp}.pdf`) });
  await page.pdf({ ...opts, path: path.join(outDir, `${prefix}-latest.pdf`) });
  await browser.close();
  console.log(`Wrote reports/${prefix}-${stamp}.pdf (and ${prefix}-latest.pdf)`);
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
