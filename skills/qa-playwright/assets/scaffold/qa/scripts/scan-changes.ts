/**
 * Change scanner: finds what changed in the codebase (or live site) since tests were last brought to full coverage,
 * and says exactly which functional and accessibility tests must be added or reviewed.
 *
 *   npm run scan:changes             scan, write coverage/CHANGES.md + artifacts/change-report.json, exit 1 if work is needed
 *   npm run scan:changes -- --accept record the current state as the new baseline (do this AFTER tests are written and passing)
 *   npm run scan:changes -- --pages  also snapshot the live pages (needs BASE_URL; always on when sourceRoots is empty)
 *
 * Source mode:  hashes every source file under matrix.sourceRoots; compares with coverage/baseline.json.
 * Page mode:    snapshots every matrix page (status, title, headings, landmarks, links, form fields, buttons)
 *               and discovers new same-site links in the navigation that are not in the matrix.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const QA = path.resolve(__dirname, '..');
const ROOT = path.resolve(QA, '..');
const matrixFile = path.join(QA, 'coverage', 'coverage-matrix.json');
const baselineFile = path.join(QA, 'coverage', 'baseline.json');
const args = new Set(process.argv.slice(2));
const accept = args.has('--accept');

interface Req { id: string; area: string; description: string; sources: string[] }
interface Matrix { project: string; sourceRoots: string[]; pages?: { name: string; route: string }[]; requirements: Req[] }
interface Snapshot { status: number; title: string; h1: string[]; headings: number; landmarks: string[]; links: number; fields: number; buttons: string[] }
interface Baseline { generated: string; files: Record<string, string>; pages: Record<string, Snapshot>; routes?: string[] }

const matrix: Matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
const baseline: Baseline | null = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;

const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.next|\.nuxt|coverage|out|\.git|__pycache__|qa)(\/|$)/;
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|html?|css|scss|py|rb|go|java|kt|cs|php|sql|prisma|graphql)$/i;
const TEST_FILE = /\.(spec|test)\.[a-z]+$|(^|\/)(__tests__|tests?)\//i;
const UI_FILE = /\.(tsx|jsx|vue|svelte|html?|css|scss)$/i;

const sha = (b: Buffer | string) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (SKIP_DIR.test(rel)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (SOURCE_EXT.test(e.name) && !TEST_FILE.test(rel)) out.push(p);
  }
  return out;
}
const covers = (src: string, file: string) => file === src || file.startsWith(src.replace(/\/$/, '') + '/');
const reqsFor = (file: string) => matrix.requirements.filter((r) => r.sources.some((s) => covers(s, file)));

async function snapshotPages(): Promise<{ pages: Record<string, Snapshot>; discovered: string[] }> {
  const { chromium } = await import('@playwright/test');
  const base = process.env.BASE_URL ?? (JSON.parse(fs.readFileSync(path.join(QA, 'artifacts', 'run-info.json'), 'utf8')).baseURL as string);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 800 } });
  const pages: Record<string, Snapshot> = {};
  const known = new Set((matrix.pages ?? []).map((p) => p.route.split('?')[0]));
  const discovered = new Set<string>();
  for (const p of matrix.pages ?? []) {
    const page = await ctx.newPage();
    try {
      const res = await page.goto(p.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2000);
      pages[p.route] = await page.evaluate((status) => ({
        status,
        title: document.title,
        h1: [...document.querySelectorAll('h1')].map((e) => (e.textContent ?? '').trim().slice(0, 80)),
        headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        landmarks: ['banner', 'navigation', 'main', 'contentinfo', 'search', 'complementary'].filter((r) =>
          document.querySelector(`[role=${r}], ${({ banner: 'header', navigation: 'nav', main: 'main', contentinfo: 'footer', search: '[type=search]', complementary: 'aside' } as Record<string, string>)[r]}`)),
        links: document.querySelectorAll('a[href]').length,
        fields: document.querySelectorAll('input:not([type=hidden]),select,textarea').length,
        buttons: [...document.querySelectorAll('button,[role=button]')].map((e) => (e.textContent ?? '').trim().slice(0, 30)).filter(Boolean).slice(0, 25),
      }), res?.status() ?? 0);
      const origin = new URL(base).origin;
      for (const href of await page.$$eval('header a[href], nav a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href))) {
        try { const u = new URL(href); if (u.origin === origin) { const r = u.pathname.replace(/\/$/, '') || '/'; if (!known.has(r) && r.split('/').length <= 2) discovered.add(r); } } catch { /* ignore */ }
      }
    } catch (e) {
      pages[p.route] = { status: -1, title: `unreachable: ${(e as Error).message.slice(0, 60)}`, h1: [], headings: 0, landmarks: [], links: 0, fields: 0, buttons: [] };
    } finally { await page.close(); }
  }
  await browser.close();
  return { pages, discovered: [...discovered].sort() };
}

(async () => {
  const roots = (matrix.sourceRoots ?? []).map((r) => path.resolve(QA, r));
  const files: Record<string, string> = {};
  for (const r of roots) for (const f of walk(r)) files[path.relative(ROOT, f).split(path.sep).join('/')] = sha(fs.readFileSync(f));

  const wantPages = args.has('--pages') || roots.length === 0;
  const live = wantPages ? await snapshotPages() : { pages: baseline?.pages ?? {}, discovered: [] as string[] };

  if (accept) {
    fs.writeFileSync(baselineFile, JSON.stringify({ generated: new Date().toISOString(), files, pages: live.pages, routes: live.discovered } satisfies Baseline, null, 2));
    console.log(`Baseline recorded: ${Object.keys(files).length} source files, ${Object.keys(live.pages).length} pages -> coverage/baseline.json`);
    return;
  }

  const old = baseline?.files ?? {};
  const added = Object.keys(files).filter((f) => !(f in old));
  const modified = Object.keys(files).filter((f) => f in old && old[f] !== files[f]);
  const deleted = Object.keys(old).filter((f) => !(f in files));
  const unmapped = Object.keys(files).filter((f) => reqsFor(f).length === 0);

  const stale = new Map<string, string[]>();
  for (const f of modified) for (const r of reqsFor(f)) stale.set(r.id, [...(stale.get(r.id) ?? []), f]);
  const uiChanged = [...added, ...modified].filter((f) => UI_FILE.test(f));

  const pageChanges: { route: string; changes: string[] }[] = [];
  for (const [route, now] of Object.entries(live.pages)) {
    const was = baseline?.pages?.[route];
    if (!was) { if (baseline) pageChanges.push({ route, changes: ['new page'] }); continue; }
    const c: string[] = [];
    if (was.status !== now.status) c.push(`status ${was.status} -> ${now.status}`);
    if (was.title !== now.title) c.push(`title "${was.title}" -> "${now.title}"`);
    if (JSON.stringify(was.h1) !== JSON.stringify(now.h1)) c.push(`h1 ${JSON.stringify(was.h1)} -> ${JSON.stringify(now.h1)}`);
    if (was.headings !== now.headings) c.push(`headings ${was.headings} -> ${now.headings}`);
    if (was.fields !== now.fields) c.push(`form fields ${was.fields} -> ${now.fields}`);
    if (JSON.stringify(was.landmarks) !== JSON.stringify(now.landmarks)) c.push(`landmarks ${was.landmarks.join('/')} -> ${now.landmarks.join('/')}`);
    const gone = was.buttons.filter((b) => !now.buttons.includes(b)), fresh = now.buttons.filter((b) => !was.buttons.includes(b));
    if (gone.length || fresh.length) c.push(`buttons +[${fresh.join(', ')}] -[${gone.join(', ')}]`);
    if (Math.abs(was.links - now.links) > Math.max(5, was.links * 0.2)) c.push(`links ${was.links} -> ${now.links}`);
    if (c.length) pageChanges.push({ route, changes: c });
  }

  // Work list: every item names the tests that must be written.
  const work: { kind: string; target: string; action: string }[] = [];
  for (const f of unmapped) work.push({ kind: 'new/unmapped code', target: f, action: 'Add a requirement (sources: this file) and write @happy, @boundary and @error tests, plus an a11y test if it renders UI' });
  for (const [id, fs_] of stale) work.push({ kind: 'changed code', target: `${id} (${fs_.join(', ')})`, action: 'Re-read the change; update affected tests, add tests for new branches, limits and errors' });
  for (const f of deleted) work.push({ kind: 'deleted code', target: f, action: 'Remove it from requirement sources; delete or update tests that exercised it' });
  for (const f of uiChanged) work.push({ kind: 'UI changed', target: f, action: 'Re-run axe on every page/state it renders; add a11y tests for new states (dialogs, errors, menus) and keyboard paths' });
  for (const p of pageChanges) work.push({ kind: 'page changed', target: `${p.route}: ${p.changes.join('; ')}`, action: 'Update locators/assertions; add functional and a11y tests for new behaviour' });
  const newRoutes = baseline ? live.discovered.filter((r) => !(baseline.routes ?? []).includes(r)) : [];
  for (const r of newRoutes) work.push({ kind: 'new route found', target: r, action: 'Add to matrix pages and requirements; write functional and a11y tests' });

  const report = { generated: new Date().toISOString(), baseline: baseline?.generated ?? null, counts: { added: added.length, modified: modified.length, deleted: deleted.length, unmapped: unmapped.length, pageChanges: pageChanges.length, newRoutes: newRoutes.length }, added, modified, deleted, unmapped, staleRequirements: Object.fromEntries(stale), uiChanged, pageChanges, newRoutes, work };
  fs.mkdirSync(path.join(QA, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(QA, 'artifacts', 'change-report.json'), JSON.stringify(report, null, 2));

  let gitNote = '';
  try { gitNote = execSync('git log -n 10 --pretty="- %h %s"', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git repo */ }
  const md = [`# Change scan`, ``, `Generated ${report.generated}. Baseline: ${report.baseline ?? '**none yet** (run \`npm run scan:changes -- --accept\` once tests are at full coverage)'}`, ``,
    `| Added | Modified | Deleted | Unmapped | Pages changed | New routes |`, `|---|---|---|---|---|---|`,
    `| ${added.length} | ${modified.length} | ${deleted.length} | ${unmapped.length} | ${pageChanges.length} | ${newRoutes.length} |`, ``,
    work.length ? `## Tests to write or review\n\n| Kind | Target | Action |\n|---|---|---|\n${work.map((w) => `| ${w.kind} | ${w.target.replace(/\|/g, '/')} | ${w.action} |`).join('\n')}` : '## Nothing to do\n\nNo changes need new tests.',
    gitNote ? `\n## Recent commits\n\n${gitNote}` : ''].join('\n');
  fs.writeFileSync(path.join(QA, 'coverage', 'CHANGES.md'), md + '\n');

  console.log(`Change scan: +${added.length} ~${modified.length} -${deleted.length} | unmapped ${unmapped.length} | pages changed ${pageChanges.length} | new routes ${newRoutes.length}`);
  if (work.length) { console.log(`${work.length} item(s) need tests. See coverage/CHANGES.md`); process.exit(1); }
  console.log('Tests are up to date with the code.');
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
