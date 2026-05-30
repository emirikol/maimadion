import { expect, test, type Page } from '@playwright/test';

// M5 — formulas. The grid shows computed values (read via the test API); the formula
// bar shows the (elided) source. Formula entry is driven through the formula bar.

interface MaiTestApi {
  select(row: number, col: number): void;
  cellText(row: number, col: number): string;
}
declare global {
  interface Window {
    __mai: MaiTestApi;
  }
}

const cellText = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => window.__mai.cellText(r, c), [row, col]);

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__mai));
  return errors;
}

// Enter a formula/value into a cell via the formula bar.
async function enter(page: Page, row: number, col: number, src: string) {
  await page.evaluate(([r, c]) => window.__mai.select(r, c), [row, col]);
  const bar = page.locator('.formula-input');
  await bar.fill(src);
  await bar.press('Enter');
}

test('M5: seeded SUM over a 1-D range and its dependent evaluate', async ({ page }) => {
  const errors = await open(page);
  expect(await cellText(page, 13, 1)).toBe('600'); // =SUM(x10:12) over 100,200,300
  expect(await cellText(page, 14, 1)).toBe('1200'); // =x13 * 2
  expect(errors, errors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/m5-formula.png' });
});

test('M5: editing a referenced cell recomputes dependents in order', async ({ page }) => {
  await open(page);
  await enter(page, 10, 1, '150'); // was 100
  expect(await cellText(page, 13, 1)).toBe('650'); // SUM(150,200,300)
  expect(await cellText(page, 14, 1)).toBe('1300'); // 650 * 2
});

test('M5: references and arithmetic evaluate, and flow on edit', async ({ page }) => {
  await open(page);
  await enter(page, 40, 3, '=6*7');
  expect(await cellText(page, 40, 3)).toBe('42');

  await enter(page, 41, 3, '=x40y3z1 * 2'); // references the cell above
  expect(await cellText(page, 41, 3)).toBe('84');

  await enter(page, 40, 3, '=6*8'); // 48 → dependent follows
  expect(await cellText(page, 41, 3)).toBe('96');
});

test('M5: the formula bar shows the elided source of a stored formula', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__mai.select(13, 1));
  // Stored fully-qualified as =SUM(x10:12y1z1); y1/z1 match context → elided.
  await expect(page.locator('.formula-input')).toHaveValue('=SUM(x10:12)');
});

test('M5: #DIV/0! is reported', async ({ page }) => {
  await open(page);
  await enter(page, 42, 3, '=1/0');
  expect(await cellText(page, 42, 3)).toBe('#DIV/0!');
});

test('M5: a circular reference resolves to #CYCLE! without hanging', async ({ page }) => {
  await open(page);
  await enter(page, 43, 3, '=x44y3z1');
  await enter(page, 44, 3, '=x43y3z1');
  expect(await cellText(page, 43, 3)).toBe('#CYCLE!');
  expect(await cellText(page, 44, 3)).toBe('#CYCLE!');
});
