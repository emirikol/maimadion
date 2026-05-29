<script lang="ts">
  import { onMount } from 'svelte';
  import Grid from '../grid/Grid.svelte';
  import FormulaBar from '../ui/FormulaBar.svelte';
  import { SheetController } from './controller.svelte';
  import { coordAt } from '../grid/projection';
  import { createSeedSheet, displayValue, readCellInput } from '../model/sheet';

  const controller = new SheetController(createSeedSheet());

  interface MaiTestApi {
    active(): { row: number; col: number };
    select(row: number, col: number): void;
    cellText(row: number, col: number): string;
  }

  onMount(() => {
    // Window test API (tech-design §17): canvas cells aren't DOM-queryable, so e2e
    // reads cell text and drives selection through this hook. Formalized in M10.
    (window as unknown as { __mai: MaiTestApi }).__mai = {
      active: () => ({ row: controller.activeRow, col: controller.activeCol }),
      select: (row, col) => controller.select(row, col),
      cellText: (row, col) =>
        displayValue(readCellInput(controller.sheet, coordAt(controller.sheet.viewport, row, col))),
    };
  });
</script>

<div class="app">
  <header>
    <h1>maimadion</h1>
    <span>M2 — edit literals</span>
  </header>
  <FormulaBar {controller} />
  <div class="grid-host">
    <Grid {controller} />
  </div>
</div>

<style>
  :global(html, body, #app) {
    height: 100%;
    margin: 0;
  }
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: system-ui, -apple-system, sans-serif;
  }
  header {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 8px 12px;
    border-bottom: 1px solid #ddd;
  }
  header h1 {
    margin: 0;
    font-size: 16px;
  }
  header span {
    color: #888;
    font-size: 12px;
  }
  .grid-host {
    flex: 1;
    min-height: 0;
  }
</style>
