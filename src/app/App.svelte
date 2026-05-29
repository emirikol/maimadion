<script lang="ts">
  import { onMount } from 'svelte';
  import Grid from '../grid/Grid.svelte';
  import FormulaBar from '../ui/FormulaBar.svelte';
  import AxisBindingControl from '../ui/AxisBindingControl.svelte';
  import Slider from '../ui/Slider.svelte';
  import { SheetController } from './controller.svelte';
  import { coordAt, hiddenAxes } from '../grid/projection';
  import { createSeedSheet, displayValue, readCellInput } from '../model/sheet';

  const controller = new SheetController(createSeedSheet());

  // The axes not on the visible row/column — each gets a slider navigator (§14).
  const hidden = $derived(
    hiddenAxes(controller.sheet.axes, {
      rowAxisId: controller.rowAxisId,
      colAxisId: controller.colAxisId,
    }),
  );

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

  onMount(() => {
    // Window test API (tech-design §17): canvas cells aren't DOM-queryable, so e2e
    // reads cell text and drives selection/navigation/binding through this hook.
    // Formalized in M10.
    (window as unknown as { __mai: MaiTestApi }).__mai = {
      active: () => ({ row: controller.activeRow, col: controller.activeCol }),
      select: (row, col) => controller.select(row, col),
      cellText: (row, col) =>
        displayValue(readCellInput(controller.sheet, coordAt(controller.projection(), row, col))),
      navigate: (axisId, index) => controller.navigate(axisId, index),
      navigated: (axisId) => controller.navigatedIndex(axisId),
      rebind: (rowAxisId, colAxisId) => controller.rebind(rowAxisId, colAxisId),
      swap: () => controller.swap(),
      binding: () => ({ row: controller.rowAxisId, col: controller.colAxisId }),
      axes: () =>
        controller.sheet.axes.map((a) => ({ id: a.id, name: a.name, count: a.positions.length })),
    };
  });
</script>

<div class="app">
  <header>
    <h1>maimadion</h1>
    <span>M3 — navigate dimensions</span>
  </header>
  <FormulaBar {controller} />
  <div class="view-controls">
    <AxisBindingControl {controller} />
    {#each hidden as axis (axis.id)}
      <Slider {controller} {axis} />
    {/each}
  </div>
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
  .view-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 6px 12px;
    border-bottom: 1px solid #ddd;
    background: #fafafa;
    font-size: 13px;
  }
  .grid-host {
    flex: 1;
    min-height: 0;
  }
</style>
