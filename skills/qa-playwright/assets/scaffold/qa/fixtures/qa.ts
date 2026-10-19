import { test as base, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The `qa` fixture is what makes every test report-ready.
 *
 *   qa.data({...})            record the test data used (shown in the PDF report)
 *   qa.step(name, fn)         run a step; a full-page screenshot is taken after it (pass or fail)
 *   qa.evidence(name, value)  record request/response or any JSON evidence (API & unit tests)
 *   qa.response(name, res)    shortcut: record status + body of an API response
 *
 * Requirement ids written in the title as [FR-001] are picked up automatically.
 * Test kinds are written in the title as tags: @boundary @error @whitebox @blackbox @happy
 */

export const ARTIFACTS = path.resolve(__dirname, '..', 'artifacts');

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export class QA {
  private seq = 0;
  private values: Record<string, unknown> = {};
  private readonly dir: string;
  private readonly id: string;

  constructor(private readonly info: TestInfo, private readonly page?: Page) {
    this.id = `${slug(info.project.name)}-${slug(info.titlePath.slice(1).join(' '))}-${info.testId}`;
    this.dir = path.join(ARTIFACTS, 'screenshots', this.id);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    for (const m of info.title.matchAll(/\[([A-Z][A-Z0-9]*-\d+)\]/g)) {
      info.annotations.push({ type: 'covers', description: m[1] });
    }
  }

  /** Record test data. Call as many times as needed; values are merged. */
  data(values: Record<string, unknown>): void {
    Object.assign(this.values, values);
  }

  /** Run a step and screenshot the page afterwards (also when the step throws). */
  async step<T>(name: string, body: () => Promise<T>): Promise<T> {
    const n = this.next();
    try {
      return await base.step(name, body);
    } finally {
      await this.shot(n, name);
    }
  }

  /** Attach JSON evidence (used where a screenshot is not possible: API, unit). */
  async evidence(name: string, value: unknown): Promise<void> {
    await this.record('evidence', name, value);
  }

  async response(name: string, res: APIResponse, request?: unknown): Promise<void> {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    await this.evidence(name, { request, url: res.url(), status: res.status(), body });
  }

  /** Attach an axe-core result set (used by helpers/a11y.ts). */
  async axe(name: string, results: unknown): Promise<void> {
    await this.record('axe', name, results);
  }

  /** Called by the fixture after the test; attaches the recorded test data. */
  async flush(): Promise<void> {
    if (!Object.keys(this.values).length) return;
    const file = path.join(this.dir, 'test-data.json');
    fs.writeFileSync(file, JSON.stringify(this.values, null, 2));
    await this.info.attach('test-data', { path: file, contentType: 'application/json' });
  }

  private next(): string {
    return String(++this.seq).padStart(2, '0');
  }

  private async shot(n: string, name: string): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    const file = path.join(this.dir, `${n}-${slug(name)}.jpg`);
    try {
      await this.page.screenshot({ path: file, fullPage: false, type: 'jpeg', quality: 80 });
      await this.info.attach(`step:${n}:${name}`, { path: file, contentType: 'image/jpeg' });
    } catch {
      /* a failed screenshot must never mask the real result */
    }
  }

  private async record(prefix: string, name: string, value: unknown): Promise<void> {
    const n = this.next();
    const file = path.join(this.dir, `${n}-${prefix}-${slug(name)}.json`);
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
    await this.info.attach(`${prefix}:${n}:${name}`, { path: file, contentType: 'application/json' });
  }
}

/** Browser tests (e2e, a11y): `qa` is bound to the `page` fixture. */
export const test = base.extend<{ qa: QA }>({
  qa: async ({ page }, use, testInfo) => {
    const qa = new QA(testInfo, page);
    await use(qa);
    await qa.flush();
  },
});

/** API tests: `qa` without a browser. Use with the `request` fixture. */
export const apiTest = base.extend<{ qa: QA }>({
  // eslint-disable-next-line no-empty-pattern
  qa: async ({}, use, testInfo) => {
    const qa = new QA(testInfo);
    await use(qa);
    await qa.flush();
  },
});

export { expect } from '@playwright/test';
