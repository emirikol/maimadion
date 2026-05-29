import { expect, test } from '@playwright/test';

// Counts non-white, non-transparent pixels on the grid canvas — proof the
// renderer drew gutters/gridlines/text rather than leaving a blank surface.
function paintedPixelCount(el: HTMLCanvasElement): number {
  const ctx = el.getContext('2d');
  if (!ctx || el.width === 0) return 0;
  const { data } = ctx.getImageData(0, 0, el.width, el.height);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250)) n++;
  }
  return n;
}

test('M1: renders the grid surface with content', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  // Poll past the Svelte mount / first-paint race rather than reading once.
  await expect
    .poll(() => page.locator('canvas').evaluate(paintedPixelCount), { timeout: 5000 })
    .toBeGreaterThan(500);

  expect(errors, errors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: 'test-results/m1-grid.png' });
});
