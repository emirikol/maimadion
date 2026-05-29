import { expect, test, type Page } from '@playwright/test';

// The canvas isn't DOM-queryable, so we read cell text and active position through
// the window test API (tech-design §17), and drive editing via real DOM events.

interface MaiTestApi {
  active(): { row: number; col: number };
  select(row: number, col: number): void;
  cellText(row: number, col: number): string;
}
declare global {
  interface Window {
    __mai: MaiTestApi;
  }
}

// Center of a body cell in CSS px relative to the grid box, at scroll 0. Mirrors
// LAYOUT in src/grid/render.ts (headerW 56, headerH 24, colW 96, rowH 24).
const cellPos = (row: number, col: number) => ({
  x: 56 + (col - 1) * 96 + 48,
  y: 24 + (row - 1) * 24 + 12,
});

const active = (page: Page) => page.evaluate(() => window.__mai.active());
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

test('M2: click-select then type a literal and commit with Enter', async ({ page }) => {
  const errors = await open(page);

  await page.locator('.grid').click({ position: cellPos(2, 3) });
  expect(await active(page)).toEqual({ row: 2, col: 3 });

  await page.keyboard.type('hello', { delay: 30 });
  await page.keyboard.press('Enter');

  expect(await cellText(page, 2, 3)).toBe('hello');
  // Enter commits and advances down a row (§16).
  expect(await active(page)).toEqual({ row: 3, col: 3 });

  expect(errors, errors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/m2-edit.png' });
});

test('M2: the formula bar mirrors and edits the active cell', async ({ page }) => {
  await open(page);

  await page.evaluate(() => window.__mai.select(10, 5));
  const bar = page.locator('.formula-input');
  await expect(bar).toHaveValue('');

  await bar.fill('from the bar');
  await bar.press('Enter');

  expect(await cellText(page, 10, 5)).toBe('from the bar');
});

test('M2: Escape cancels an edit and leaves the cell unchanged', async ({ page }) => {
  await open(page);

  // Cell (1,1) holds the seed literal "maimadion".
  await page.locator('.grid').click({ position: cellPos(1, 1) });
  expect(await cellText(page, 1, 1)).toBe('maimadion');

  await page.keyboard.type('overwrite', { delay: 30 });
  await page.keyboard.press('Escape');

  expect(await cellText(page, 1, 1)).toBe('maimadion');
});

test('M2: arrow keys move the active cell', async ({ page }) => {
  await open(page);

  await page.locator('.grid').click({ position: cellPos(4, 4) });
  expect(await active(page)).toEqual({ row: 4, col: 4 });

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  expect(await active(page)).toEqual({ row: 5, col: 5 });
});
