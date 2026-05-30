import { expect, test, type Page } from '@playwright/test';

// M7 — operations & undo. Every data edit is a discrete op on a linear undo log (§10);
// behaviour is unchanged from M6 but each logical edit is now undoable/redoable. State
// is read through the window test API (§17); edits are driven through real DOM events,
// undo/redo through the keyboard, the toolbar buttons, and the test API.

interface MaiTestApi {
  active(): { row: number; col: number };
  select(row: number, col: number): void;
  cellText(row: number, col: number): string;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
declare global {
  interface Window {
    __mai: MaiTestApi;
  }
}

// Center of a body cell in CSS px relative to the grid box at scroll 0 (mirrors LAYOUT
// in src/grid/render.ts: headerW 56, headerH 24, colW 96, rowH 24).
const cellPos = (row: number, col: number) => ({
  x: 56 + (col - 1) * 96 + 48,
  y: 24 + (row - 1) * 24 + 12,
});

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

// Enter a value into a cell via the formula bar (mirrors formula.spec).
async function enter(page: Page, row: number, col: number, src: string) {
  await page.evaluate(([r, c]) => window.__mai.select(r, c), [row, col]);
  const bar = page.locator('.formula-input');
  await bar.fill(src);
  await bar.press('Enter');
}

test('M7: undo a typed literal back to empty, then redo it', async ({ page }) => {
  const errors = await open(page);

  await page.locator('.grid').click({ position: cellPos(2, 3) });
  await page.keyboard.type('hello', { delay: 20 });
  await page.keyboard.press('Enter');
  expect(await cellText(page, 2, 3)).toBe('hello');

  await page.evaluate(() => window.__mai.undo());
  expect(await cellText(page, 2, 3)).toBe('');

  await page.evaluate(() => window.__mai.redo());
  expect(await cellText(page, 2, 3)).toBe('hello');

  expect(errors, errors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/m7-undo.png' });
});

test('M7: undo restores a cell to its previous value', async ({ page }) => {
  await open(page);
  // (1,1) holds the seed literal "maimadion".
  await enter(page, 1, 1, 'changed');
  expect(await cellText(page, 1, 1)).toBe('changed');

  await page.evaluate(() => window.__mai.undo());
  expect(await cellText(page, 1, 1)).toBe('maimadion');
});

test('M7: undo/redo recompute formula dependents', async ({ page }) => {
  await open(page);
  expect(await cellText(page, 13, 1)).toBe('600'); // =SUM(x10:12) over 100,200,300

  await enter(page, 10, 1, '150'); // 100 → 150 lifts the SUM
  expect(await cellText(page, 13, 1)).toBe('650');
  expect(await cellText(page, 14, 1)).toBe('1300'); // =x13 * 2

  await page.evaluate(() => window.__mai.undo());
  expect(await cellText(page, 13, 1)).toBe('600');
  expect(await cellText(page, 14, 1)).toBe('1200');
});

test('M7: editing a fibered cell is undoable', async ({ page }) => {
  await open(page);
  // Column 12 / page 1 is the seeded "shared" fiber, free down the rows.
  await enter(page, 5, 12, 'renamed');
  expect(await cellText(page, 1, 12)).toBe('renamed');

  await page.evaluate(() => window.__mai.undo());
  expect(await cellText(page, 1, 12)).toBe('shared');
});

test('M7: keyboard Cmd/Ctrl+Z undoes and Shift+Cmd/Ctrl+Z redoes', async ({ page }) => {
  await open(page);

  await page.locator('.grid').click({ position: cellPos(2, 4) });
  await page.keyboard.type('x', { delay: 20 });
  await page.keyboard.press('Enter'); // commits and refocuses the grid
  expect(await cellText(page, 2, 4)).toBe('x');

  await page.keyboard.press('ControlOrMeta+z');
  expect(await cellText(page, 2, 4)).toBe('');

  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await cellText(page, 2, 4)).toBe('x');
});

test('M7: the toolbar Undo/Redo buttons reflect availability and apply edits', async ({ page }) => {
  await open(page);
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await enter(page, 2, 5, 'note');
  await expect(undo).toBeEnabled();

  await undo.click();
  expect(await cellText(page, 2, 5)).toBe('');
  await expect(redo).toBeEnabled();

  await redo.click();
  expect(await cellText(page, 2, 5)).toBe('note');
});
