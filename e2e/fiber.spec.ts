import { expect, test, type Page } from '@playwright/test';

// M4 — literal fibers: a value held constant across whole axes. Read state through
// the window test API (§17); drive the grid and the FlatDialog through real events.

interface MaiTestApi {
  active(): { row: number; col: number };
  select(row: number, col: number): void;
  cellText(row: number, col: number): string;
  cellSource(row: number, col: number): string;
  navigate(axisId: string, index: number): void;
  fiberCount(): number;
  defineFiber(
    freeAxisIds: string[],
    raw: string,
    absorb?: boolean,
  ): { ok: boolean; reason?: string; count: number };
}
declare global {
  interface Window {
    __mai: MaiTestApi;
  }
}

// Center of a body cell in CSS px relative to the grid box at scroll 0 (mirrors
// LAYOUT in src/grid/render.ts: headerW 56, headerH 24, colW 96, rowH 24).
const cellPos = (row: number, col: number) => ({
  x: 56 + (col - 1) * 96 + 48,
  y: 24 + (row - 1) * 24 + 12,
});

const cellText = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => window.__mai.cellText(r, c), [row, col]);
const cellSource = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => window.__mai.cellSource(r, c), [row, col]);
const fiberCount = (page: Page) => page.evaluate(() => window.__mai.fiberCount());

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__mai));
  return errors;
}

test('M4: the seeded fiber reads the same value across its spanned axis', async ({ page }) => {
  await open(page);
  // Column 12 (page 1) is fibered, free on rows → every row reads "shared".
  expect(await cellText(page, 1, 12)).toBe('shared');
  expect(await cellText(page, 50, 12)).toBe('shared');
  expect(await cellSource(page, 1, 12)).toBe('flat');
  // Pinned to page 1: it does not bleed onto other pages.
  await page.evaluate(() => window.__mai.navigate('axis-page', 2));
  expect(await cellSource(page, 1, 12)).toBe('empty');
  expect(await fiberCount(page)).toBe(1);
});

test('M4: editing any member updates the whole fiber', async ({ page }) => {
  const errors = await open(page);

  await page.locator('.grid').click({ position: cellPos(5, 12) });
  await page.keyboard.type('renamed', { delay: 20 });
  await page.keyboard.press('Enter');

  // Every covered cell now shows the new value — and it is still one fiber.
  expect(await cellText(page, 5, 12)).toBe('renamed');
  expect(await cellText(page, 20, 12)).toBe('renamed');
  expect(await cellSource(page, 20, 12)).toBe('flat');
  expect(await fiberCount(page)).toBe(1);

  expect(errors, errors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/m4-fiber.png' });
});

test('M4: clearing a fibered cell removes the whole fiber', async ({ page }) => {
  await open(page);
  await page.locator('.grid').click({ position: cellPos(5, 12) });
  await page.keyboard.press('Delete');

  expect(await cellSource(page, 5, 12)).toBe('empty');
  expect(await cellSource(page, 30, 12)).toBe('empty');
  expect(await fiberCount(page)).toBe(0);
});

test('M4: define a constant down a column through the dialog', async ({ page }) => {
  await open(page);
  // Anchor on an empty column so spanning the rows collides with nothing.
  await page.evaluate(() => window.__mai.select(3, 15));

  await page.locator('.define-constant').click();
  await expect(page.locator('.flat-dialog')).toBeVisible();
  // The row axis is spanned by default; pin the column + page at the active cell.
  await expect(page.locator('.flat-dialog input[data-axis="axis-row"]')).toBeChecked();
  await page.locator('.flat-value').fill('Header');
  await page.locator('.flat-dialog .create').click();

  await expect(page.locator('.flat-dialog')).toHaveCount(0); // closed on success
  expect(await cellText(page, 3, 15)).toBe('Header');
  expect(await cellText(page, 40, 15)).toBe('Header'); // constant down the column
  expect(await cellSource(page, 3, 15)).toBe('flat');
  expect(await fiberCount(page)).toBe(2); // seed + the new one
});

test('M4: the dialog reports an overlap and keeps the fiber count', async ({ page }) => {
  await open(page);
  // Anchor on the seeded fiber's column; spanning rows reproduces it exactly.
  await page.evaluate(() => window.__mai.select(1, 12));

  await page.locator('.define-constant').click();
  await page.locator('.flat-value').fill('clash');
  await page.locator('.flat-dialog .create').click();

  await expect(page.locator('.flat-dialog .error')).toBeVisible();
  await expect(page.locator('.flat-dialog')).toBeVisible(); // stays open
  expect(await fiberCount(page)).toBe(1); // not created
});

test('M4: covering explicit cells is rejected, then absorbed on overwrite', async ({ page }) => {
  await open(page);
  // Column 1, page 1, free on rows covers the explicit (1,1)="maimadion".
  const blocked = await page.evaluate(() =>
    window.__mai.defineFiber(['axis-row'], 'label', false),
  );
  expect(blocked.ok).toBe(false);
  expect(blocked.reason).toBe('explicit-collision');
  expect(blocked.count).toBeGreaterThan(0);
  expect(await fiberCount(page)).toBe(1); // seed only — not created

  const absorbed = await page.evaluate(() =>
    window.__mai.defineFiber(['axis-row'], 'label', true),
  );
  expect(absorbed.ok).toBe(true);
  // The explicit "maimadion" was absorbed; the coordinate is now fibered.
  expect(await cellText(page, 1, 1)).toBe('label');
  expect(await cellSource(page, 1, 1)).toBe('flat');
  expect(await fiberCount(page)).toBe(2);
});
