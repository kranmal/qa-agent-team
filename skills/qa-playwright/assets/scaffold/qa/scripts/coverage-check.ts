/**
 * Functional coverage tracker.
 *
 * Reads coverage/coverage-matrix.json (every requirement/feature found in the codebase),
 * scans tests/** for requirement ids in test titles ("[FR-001] @boundary ...") and
 * manual/manual-tests.json for manual coverage, then writes:
 *   coverage/COVERAGE.md        human-readable, commit it
 *   artifacts/coverage-report.json  consumed by the PDF report
 * Exits 1 when anything is uncovered, lacks boundary/error tests, or source files are unmapped.
 */
import fs from 'node:fs';
import path from 'node:path';

const QA_DIR = path.resolve(__dirname, '..');
const matrixFile = path.join(QA_DIR, 'coverage', 'coverage-matrix.json');

interface Requirement {
  id: string;
  area: string;
  description: string;
  sources: string[];
  priority?: 'high' | 'medium' | 'low';
  /** Why a boundary/error test does not apply, e.g. { boundary: "no inputs" } */
  exemptions?: { boundary?: string; error?: string };
  /** Required when only manual tests cover it: why automation is not possible. */
  manualReason?: string;
}
interface Matrix {
  project: string;
  sourceRoots: string[];
  /** Every user-facing route/page. Each must be scanned by a test in tests/a11y. */
  pages?: { name: string; route: string }[];
  requirements: Requirement[];
}
interface Found {
  level: 'e2e' | 'api' | 'unit';
  file: string;
  title: string;
  tags: string[];
}

const matrix: Matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8'));

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1. Automated tests: parse titles from tests/**
const found = new Map<string, Found[]>();
// Matches test('title'), it.skip('title') and it.each(table)('title')
const titleRe = /\b(?:test|it)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1).)*)\1|\b(?:test|it)\.each\((?:[^;]*?)\)\(\s*(['"`])((?:\\.|(?!\3).)*)\3/g;
for (const level of ['e2e', 'api', 'unit'] as const) {
  for (const file of walk(path.join(QA_DIR, 'tests', level)).filter((f) => /\.(spec|test)\.ts$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(titleRe)) {
      const title = m[2] ?? m[4];
      const ids = [...title.matchAll(/\[([A-Z][A-Z0-9]*-\d+)\]/g)].map((x) => x[1]);
      const tags = [...title.matchAll(/@(\w+)/g)].map((x) => x[1]);
      for (const id of ids) {
        found.set(id, [...(found.get(id) ?? []), { level, file: path.relative(QA_DIR, file), title, tags }]);
      }
    }
  }
}

// 2. Manual tests
const manualFile = path.join(QA_DIR, 'manual', 'manual-tests.json');
const manual = new Map<string, string[]>();
if (fs.existsSync(manualFile)) {
  for (const t of JSON.parse(fs.readFileSync(manualFile, 'utf8')).tests ?? []) {
    for (const id of t.covers ?? []) manual.set(id, [...(manual.get(id) ?? []), t.id ?? t.name]);
  }
}

// 3. Per-requirement status
const rows = matrix.requirements.map((r) => {
  const auto = found.get(r.id) ?? [];
  const man = manual.get(r.id) ?? [];
  const tags = new Set(auto.flatMap((a) => a.tags));
  const levels = ['e2e', 'api', 'unit'].filter((l) => auto.some((a) => a.level === l));
  const gaps: string[] = [];
  if (!auto.length && !man.length) gaps.push('UNCOVERED');
  if (!auto.length && man.length && !r.manualReason) gaps.push('manual-only without manualReason');
  if (auto.length) {
    if (!tags.has('boundary') && !r.exemptions?.boundary) gaps.push('no @boundary test');
    if (!tags.has('error') && !r.exemptions?.error) gaps.push('no @error test');
    if (!tags.has('blackbox') && !tags.has('whitebox')) gaps.push('no @blackbox/@whitebox tag');
  }
  const status = !auto.length && !man.length ? 'uncovered' : auto.length ? 'automated' : 'manual';
  return { ...r, status, levels, automated: auto.length, manual: man, tags: [...tags], gaps };
});

// 4. Source files that no requirement points at
const mapped = new Set(matrix.requirements.flatMap((r) => r.sources.map((s) => path.normalize(s))));
const skip = /(node_modules|[\\/]dist[\\/]|[\\/]build[\\/]|\.next|[\\/]qa[\\/]|\.d\.ts$|\.(test|spec|stories)\.|__tests__)/;
const unmapped: string[] = [];
for (const root of matrix.sourceRoots) {
  const abs = path.resolve(QA_DIR, root);
  for (const f of walk(abs)) {
    if (!/\.(tsx?|jsx?|vue|svelte|py|go|rb|java|cs|php)$/.test(f) || skip.test(f)) continue;
    const rel = path.normalize(path.relative(path.resolve(QA_DIR, '..'), f));
    if (![...mapped].some((m) => rel === m || rel.startsWith(m + path.sep))) unmapped.push(rel);
  }
}

// 4b. Pages with no accessibility test (a route must appear in some tests/a11y file)
const a11yText = walk(path.join(QA_DIR, 'tests', 'a11y')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const a11yMissing = (matrix.pages ?? []).filter((p) => !a11yText.includes(`'${p.route}'`) && !a11yText.includes(`"${p.route}"`) && !a11yText.includes(`\`${p.route}\``));

// 5. Output
const total = rows.length;
const covered = rows.filter((r) => r.status !== 'uncovered').length;
const clean = rows.filter((r) => !r.gaps.length).length;
const summary = {
  project: matrix.project,
  generated: new Date().toISOString(),
  total,
  automated: rows.filter((r) => r.status === 'automated').length,
  manualOnly: rows.filter((r) => r.status === 'manual').length,
  uncovered: rows.filter((r) => r.status === 'uncovered').length,
  fullyCompliant: clean,
  coveragePct: total ? Math.round((covered / total) * 1000) / 10 : 100,
  unmappedSourceFiles: unmapped,
  pagesTotal: (matrix.pages ?? []).length,
  pagesWithoutA11yTest: a11yMissing.map((p) => p.route),
};
fs.mkdirSync(path.join(QA_DIR, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(QA_DIR, 'artifacts', 'coverage-report.json'), JSON.stringify({ summary, rows }, null, 2));

const md = [
  `# Test coverage - ${matrix.project}`,
  '',
  `Generated ${summary.generated}`,
  '',
  `**${summary.coveragePct}%** of ${total} requirements covered ` +
    `(${summary.automated} automated, ${summary.manualOnly} manual-only, ${summary.uncovered} uncovered). ` +
    `${clean}/${total} meet the boundary + error-handling bar.`,
  '',
  '| ID | Area | Requirement | Status | Levels | Manual | Gaps |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.area} | ${r.description} | ${r.status} | ${r.levels.join(', ') || '-'} | ${r.manual.join(', ') || '-'} | ${r.gaps.join('; ') || '-'} |`,
  ),
  '',
  a11yMissing.length ? `## Pages without an accessibility test\n\n${a11yMissing.map((p) => `- ${p.name} (${p.route})`).join('\n')}\n` : '',
  unmapped.length ? `## Source files not mapped to any requirement\n\n${unmapped.map((u) => `- ${u}`).join('\n')}\n` : '',
].join('\n');
fs.writeFileSync(path.join(QA_DIR, 'coverage', 'COVERAGE.md'), md);

console.log(md.split('\n').slice(0, 5).join('\n'));
const problems = rows.filter((r) => r.gaps.length);
for (const r of problems) console.log(`  ✗ ${r.id}: ${r.gaps.join('; ')}`);
if (unmapped.length) console.log(`  ✗ ${unmapped.length} source file(s) not mapped to a requirement (see coverage/COVERAGE.md)`);
if (a11yMissing.length) console.log(`  ✗ ${a11yMissing.length} page(s) without an accessibility test: ${a11yMissing.map((p) => p.route).join(', ')}`);
process.exit(problems.length || unmapped.length || a11yMissing.length ? 1 : 0);
