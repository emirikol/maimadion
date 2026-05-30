import { expect, test, type Page } from '@playwright/test';

// M6 — fibers complete. A fiber's shared value may itself be a formula: computed once,
// shared across the whole fiber, and a single depgraph node — so editing the fiber, or
// a dependency of its formula, recomputes every dependent. State is read through the
// window test API (§17); cell entry is driven through the formula bar.

interface MaiTestApi {
  select(row: number, col: number): void;
  cellText(row: number, col: number): string;
  cellSource(row: number, col: number): string;
  fiberCount(): number;
}
declare global {
  interface Window {
    __mai: MaiTestApi;
  }
}

const cellText = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => window.__mai.cellText(r, c), [row, col]);
const cellSource = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => window.__mai.cellSource(r, c), [row, col]);

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__mai));
  return errors;
}

// Enter a formula/value into a cell via the formula bar (mirrors formula.spec).
async function enter(page: Page, row: number, col: number, src: string) {
  await page.evaluate(([r, c]) => window.__mai.select(r, c), [row, col]);
  const bar = page.locator('.formula-input');
  await bar.fill(src);
  await bar.press('Enter');
}

test('M6: the seeded formula fiber computes once and is constant down its column', async ({ page }) => {
  const errors = await open(page);
  // Column 9, page 1, free on rows: the column-1 SUM (600) held down the whole column.
  expect(await cellText(page, 1, 9)).toBe('600');
  expect(await cellText(page, 40, 9)).toBe('600');
  expect(await cellSource(page, 40, 9)).toBe('flat');
  // A cell reading the fibered column follows it: x16y1z1 = x1y9z1 + 1.
  expect(await cellText(page, 16, 1)).toBe('601');
  expect(errors, errors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/m6-fiber-formula.png' });
});

test('M6: editing a dependency recomputes the SUM, then the fiber, then its reader', async ({ page }) => {
  await open(page);
  await enter(page, 10, 1, '150'); // 100 → 150 lifts the SUM to 650
  expect(await cellText(page, 13, 1)).toBe('650'); // the SUM
  expect(await cellText(page, 1, 9)).toBe('650'); // the formula fiber follows
  expect(await cellText(page, 16, 1)).toBe('651'); // the reader follows
});

test('M6: a fibered cell edited to a formula becomes a formula-valued fiber', async ({ page }) => {
  await open(page);
  // The column-12 "shared" literal fiber → give it a formula via the formula bar.
  await enter(page, 5, 12, '=x13y1z1 / 2'); // 600 / 2
  expect(await cellText(page, 5, 12)).toBe('300');
  expect(await cellText(page, 30, 12)).toBe('300'); // constant down the whole column
  expect(await cellSource(page, 30, 12)).toBe('flat'); // still one fiber
  expect(await page.evaluate(() => window.__mai.fiberCount())).toBe(2);
});

test('M6: a formula reading a fibered cell recomputes when the fiber input changes', async ({ page }) => {
  await open(page);
  await enter(page, 5, 12, '=40 + 2'); // make the column-12 fiber numeric (42)
  await enter(page, 30, 1, '=x1y12z1 + 8'); // a cell reading the fibered column
  expect(await cellText(page, 30, 1)).toBe('50');
  await enter(page, 7, 12, '=100'); // edit any member → the fiber's shared formula changes
  expect(await cellText(page, 30, 1)).toBe('108'); // the reader recomputes
});

test('M6: define a formula-valued fiber through the dialog', async ({ page }) => {
  await open(page);
  // Anchor on an empty column; the row axis is spanned by default.
  await page.evaluate(() => window.__mai.select(3, 17));
  await page.locator('.define-constant').click();
  await expect(page.locator('.flat-dialog')).toBeVisible();
  await page.locator('.flat-value').fill('=x13y1z1 + 4'); // 600 + 4
  await page.locator('.flat-dialog .create').click();

  await expect(page.locator('.flat-dialog')).toHaveCount(0); // closed on success
  expect(await cellText(page, 3, 17)).toBe('604');
  expect(await cellText(page, 40, 17)).toBe('604'); // constant down the column
  expect(await cellSource(page, 3, 17)).toBe('flat');
});
