import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import type { QA } from '../fixtures/qa';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface ScanOptions {
  /** CSS selectors to leave out (third-party widgets, etc.). Document why in the test. */
  exclude?: string[];
  /** Limit the scan to one region. */
  include?: string;
  /** axe rule ids to disable. Document why in the test. */
  disableRules?: string[];
  /** Impacts that fail the test. Default: all of them. */
  failOn?: Impact[];
}

/**
 * Run axe-core on the current page state, attach the full result set for the PDF report,
 * then fail if violations at or above the configured impacts were found.
 * See https://playwright.dev/docs/accessibility-testing
 */
export async function scanA11y(qa: QA, page: Page, name: string, opts: ScanOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);
  if (opts.include) builder = builder.include(opts.include);
  if (opts.disableRules?.length) builder = builder.disableRules(opts.disableRules);

  const results = await builder.analyze();
  await qa.axe(name, results);

  const failOn = opts.failOn ?? ['minor', 'moderate', 'serious', 'critical'];
  const failing = results.violations.filter((v) => failOn.includes(v.impact as Impact));
  expect(
    failing.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} element(s)`),
    `Accessibility violations on "${name}"`,
  ).toEqual([]);
  return results;
}
