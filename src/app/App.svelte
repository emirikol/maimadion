<script lang="ts">
  import { onMount } from 'svelte';
  import Grid from '../grid/Grid.svelte';
  import FormulaBar from '../ui/FormulaBar.svelte';
  import AxisBindingControl from '../ui/AxisBindingControl.svelte';
  import Slider from '../ui/Slider.svelte';
  import FlatDialog from '../ui/FlatDialog.svelte';
  import { SheetController } from './controller.svelte';
  import { coordAt, hiddenAxes } from '../grid/projection';
  import { createSeedSheet, displayValue, readCell } from '../model/sheet';

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
    cellSource(row: number, col: number): string;
    navigate(axisId: string, index: number): void;
    navigated(axisId: string): number;
    rebind(rowAxisId: string, colAxisId: string): void;
    swap(): void;
    binding(): { row: string; col: string };
    axes(): { id: string; name: string; count: number }[];
    fiberCount(): number;
    defineFiber(
      freeAxisIds: string[],
      raw: string,
      absorb?: boolean,
    ): { ok: boolean; reason?: string; count: number };
  }

  onMount(() => {
    // Window test API (tech-design §17): canvas cells aren't DOM-queryable, so e2e
    // reads cell text/source and drives selection/navigation/binding/fibers through
    // this hook. Formalized in M10.
    (window as unknown as { __mai: MaiTestApi }).__mai = {
      active: () => ({ row: controller.activeRow, col: controller.activeCol }),
      select: (row, col) => controller.select(row, col),
      cellText: (row, col) =>
        displayValue(readCell(controller.sheet, coordAt(controller.projection(), row, col)).input),
      cellSource: (row, col) =>
        readCell(controller.sheet, coordAt(controller.projection(), row, col)).source,
      navigate: (axisId, index) => controller.navigate(axisId, index),
      navigated: (axisId) => controller.navigatedIndex(axisId),
      rebind: (rowAxisId, colAxisId) => controller.rebind(rowAxisId, colAxisId),
      swap: () => controller.swap(),
      binding: () => ({ row: controller.rowAxisId, col: controller.colAxisId }),
      axes: () =>
        controller.sheet.axes.map((a) => ({ id: a.id, name: a.name, count: a.positions.length })),
      fiberCount: () => controller.sheet.flats.length,
      defineFiber: (freeAxisIds, raw, absorb = false) => {
        const r = controller.createFiber(freeAxisIds, raw, absorb);
        return r.ok
          ? { ok: true, count: 0 }
          : { ok: false, reason: r.reason, count: r.reason === 'explicit-collision' ? r.keys.length : 0 };
      },
    };
  });
</script>

<div class="app">
  <header>
    <h1>maimadion</h1>
    <span>M4 — literal fibers</span>
  </header>
  <FormulaBar {controller} />
  <div class="view-controls">
    <AxisBindingControl {controller} />
    {#each hidden as axis (axis.id)}
      <Slider {controller} {axis} />
    {/each}
    <button class="define-constant" type="button" onclick={() => controller.openFlatDialog()}>
      Define constant…
    </button>
  </div>
  <div class="grid-host">
    <Grid {controller} />
  </div>
</div>

{#if controller.flatDialogOpen}
  <FlatDialog {controller} />
{/if}

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
  .define-constant {
    margin-left: auto;
    font: inherit;
    padding: 2px 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  .define-constant:hover {
    background: #f0f0f0;
  }
  .grid-host {
    flex: 1;
    min-height: 0;
  }
</style>
