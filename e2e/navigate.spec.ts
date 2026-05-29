import { expect, test, type Page } from '@playwright/test';

// M3 — navigating a third dimension and rebinding the visible axes. Cell text and
// view state are read through the window test API (tech-design §17); the slider is
// also driven through its real DOM <input type=range> to prove the wiring.

interface MaiTestApi {
  active(): { row: number; col: number };
  select(row: number, col: number): void;
  cellText(row: number, col: number): string;
  navigate(axisId: string, index: number): void;
  navigated(axisId: string): number;
  rebind(rowAxisId: string, colAxisId: string): void;
  swap(): void;
  binding(): { row: string; col: string };
  axes(): { id: string; name: string; count: number }[];
}
declare global {
  interface Window {
    __mai: MaiTestApi;
  }
}

const active = (page: Page) => page.evaluate(() => window.__mai.active());
const binding = (page: Page) => page.evaluate(() => window.__mai.binding());
const cellText = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => window.__mai.cellText(r, c), [row, col]);

// Set a range input's value and fire a real `input` event (what Svelte's oninput
// listens for) — robust across Playwright versions, which don't all support fill()
// on type=range.
async function dragSlider(page: Page, axisId: string, value: number) {
  await page
    .locator(`.navigator[data-axis="${axisId}"] input[type="range"]`)
    .evaluate((el, v) => {
      const input = el as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setValue.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__mai));
  return errors;
}

test('M3: there is one slider per hidden axis (the page axis)', async ({ page }) => {
  await open(page);
  // Two visible axes (rows, cols) + one hidden (pages) → exactly one navigator.
  await expect(page.locator('.navigator')).toHaveCount(1);
  await expect(page.locator('.navigator[data-axis="axis-page"]')).toBeVisible();
});

test('M3: dragging the page slider changes the visible slice', async ({ page }) => {
  const errors = await open(page);

  // z=1 layer holds the original seed; (1,1) reads "maimadion".
  expect(await cellText(page, 1, 1)).toBe('maimadion');

  // Drive the real range input to page 2.
  await dragSlider(page, 'axis-page', 2);

  expect(await page.evaluate(() => window.__mai.navigated('axis-page'))).toBe(2);
  expect(await cellText(page, 1, 1)).toBe('page two');
  expect(await cellText(page, 2, 2)).toBe('alpha');
  // A value that lives only on z=1 is gone from the z=2 slice.
  expect(await cellText(page, 3, 2)).toBe('');

  // Navigating does not move the active cell off its screen position (§12).
  expect(await active(page)).toEqual({ row: 1, col: 1 });

  expect(errors, errors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/m3-navigate.png' });
});

test('M3: an edit lands on the slice it was made on, not the navigated-to slice', async ({
  page,
}) => {
  await open(page);

  await page.evaluate(() => window.__mai.select(7, 7));
  await page.locator('.formula-input').fill('made on page 1');
  await page.locator('.formula-input').press('Enter');
  expect(await cellText(page, 7, 7)).toBe('made on page 1');

  // Move to page 3: the edited cell is not on this slice.
  await dragSlider(page, 'axis-page', 3);
  expect(await cellText(page, 7, 7)).toBe('');

  // Back to page 1: still there.
  await dragSlider(page, 'axis-page', 1);
  expect(await cellText(page, 7, 7)).toBe('made on page 1');
});

test('M3: rebinding the column axis re-projects without moving data', async ({ page }) => {
  await open(page);
  expect(await binding(page)).toEqual({ row: 'axis-row', col: 'axis-col' });

  // Put the page axis on the columns; the old column axis (cols) becomes hidden.
  await page.evaluate(() => window.__mai.rebind('axis-row', 'axis-page'));
  expect(await binding(page)).toEqual({ row: 'axis-row', col: 'axis-page' });

  // Now there's a navigator for the displaced "cols" axis instead of "pages".
  await expect(page.locator('.navigator[data-axis="axis-col"]')).toBeVisible();
  await expect(page.locator('.navigator[data-axis="axis-page"]')).toHaveCount(0);

  // With cols pinned at 1, screen (row=1, col=1) projects to {row1, col1, page1} =
  // the seed "maimadion"; screen (row=1, col=2) is now page 2 → "page two".
  expect(await cellText(page, 1, 1)).toBe('maimadion');
  expect(await cellText(page, 1, 2)).toBe('page two');
});

test('M3: swap exchanges the row and column axes', async ({ page }) => {
  await open(page);
  await page.locator('.axis-binding .swap').click();
  expect(await binding(page)).toEqual({ row: 'axis-col', col: 'axis-row' });
  // Still exactly one hidden axis (pages); swapping never collapses the binding.
  await expect(page.locator('.navigator')).toHaveCount(1);
});

test('M3: rebinding to a smaller axis clamps the active cell into range', async ({ page }) => {
  await open(page);
  // Move far down the 100-long row axis, then put the 5-long page axis on the rows.
  await page.evaluate(() => window.__mai.select(40, 3));
  expect(await active(page)).toEqual({ row: 40, col: 3 });

  await page.evaluate(() => window.__mai.rebind('axis-page', 'axis-col'));
  // Row 40 is out of range on a 5-position axis → clamped to the last row.
  const a = await active(page);
  expect(a.row).toBe(5);
  expect(a.col).toBe(3);
});
