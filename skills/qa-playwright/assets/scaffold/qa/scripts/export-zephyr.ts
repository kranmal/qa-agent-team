/**
 * Turns manual/manual-tests.json into a Zephyr Scale import file.
 *   manual/zephyr-import.csv   import via Zephyr Scale > Test Cases > Import (Excel/CSV)
 *   manual/manual-tests.md     readable copy for review
 * Also lints for the house style: plain English, short, to the point.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(__dirname, '..', 'manual');
const src = JSON.parse(fs.readFileSync(path.join(dir, 'manual-tests.json'), 'utf8'));

interface Step { step: string; data?: string; expected: string }
interface Manual {
  id: string;
  name: string;
  objective: string;
  precondition?: string;
  folder?: string;
  priority?: 'High' | 'Normal' | 'Low';
  labels?: string[];
  covers?: string[];
  reason: string;
  steps: Step[];
}

const tests: Manual[] = src.tests ?? [];
const words = (s: string) => s.trim().split(/\s+/).length;
let warnings = 0;
const warn = (t: Manual, msg: string) => { warnings++; console.warn(`  ! ${t.id}: ${msg}`); };

for (const t of tests) {
  if (words(t.objective) > 30) warn(t, 'objective over 30 words');
  if (t.steps.length > 12) warn(t, 'more than 12 steps - split the test');
  if (!t.reason) warn(t, 'missing reason why this cannot be automated');
  t.steps.forEach((s, i) => {
    if (words(s.step) > 25) warn(t, `step ${i + 1} over 25 words`);
    if (words(s.expected) > 25) warn(t, `step ${i + 1} expected result over 25 words`);
    if (!s.expected) warn(t, `step ${i + 1} has no expected result`);
  });
}

const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
const header = [
  'Name', 'Objective', 'Precondition', 'Folder', 'Status', 'Priority', 'Labels',
  'Test Script (Step-by-Step) - Step', 'Test Script (Step-by-Step) - Test Data', 'Test Script (Step-by-Step) - Expected Result',
];
const lines = [header.map(esc).join(',')];
for (const t of tests) {
  t.steps.forEach((s, i) => {
    const first = i === 0;
    lines.push([
      first ? `${t.id} ${t.name}` : '', first ? t.objective : '', first ? t.precondition ?? '' : '',
      first ? t.folder ?? '/QA' : '', first ? 'Draft' : '', first ? t.priority ?? 'Normal' : '',
      first ? [...(t.labels ?? []), ...(t.covers ?? [])].join(',') : '',
      s.step, s.data ?? '', s.expected,
    ].map(esc).join(','));
  });
}
fs.writeFileSync(path.join(dir, 'zephyr-import.csv'), lines.join('\n') + '\n');

const md = tests.map((t) =>
  [`## ${t.id} ${t.name}`, `Objective: ${t.objective}`, t.precondition ? `Precondition: ${t.precondition}` : '',
   `Not automated because: ${t.reason}`, '',
   ...t.steps.map((s, i) => `${i + 1}. ${s.step}${s.data ? ` (data: ${s.data})` : ''}  \n   Expected: ${s.expected}`), ''].filter((l) => l !== undefined).join('\n'),
).join('\n');
fs.writeFileSync(path.join(dir, 'manual-tests.md'), `# Manual tests (Zephyr Scale)\n\n${md}`);
console.log(`Exported ${tests.length} manual test(s) -> manual/zephyr-import.csv${warnings ? ` (${warnings} style warning(s))` : ''}`);
