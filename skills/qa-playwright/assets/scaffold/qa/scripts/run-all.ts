/** Runs every suite (continuing past failures), then coverage check and the PDF reports. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
fs.rmSync(path.join(root, 'artifacts'), { recursive: true, force: true });

const steps: [string, string][] = [
  ['e2e', 'npm run test:e2e'],
  ['api', 'npm run test:api'],
  ['unit', 'npm run test:unit'],
  ['a11y', 'npm run test:a11y'],
  ['coverage', 'npm run coverage:check'],
  ['report', 'npm run report'],
  ['a11y report', 'npm run report:a11y'],
  ['bug report', 'npm run report:bugs'],
];
const failed: string[] = [];
for (const [name, cmd] of steps) {
  console.log(`\n=== ${name} ===`);
  if (spawnSync(cmd, { cwd: root, stdio: 'inherit', shell: true }).status !== 0) failed.push(name);
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : '\nAll suites passed.');
console.log('Reports: qa/reports/');
process.exit(failed.length ? 1 : 0);
