<script lang="ts">
  // Pick which axes sit on the visible row and column (tech-design §14). The two
  // must stay distinct: choosing, for one axis, the axis currently on the other
  // simply swaps them — which keeps them distinct and matches what the user means.
  import type { SheetController } from '../app/controller.svelte';

  let { controller }: { controller: SheetController } = $props();

  const axes = $derived(controller.sheet.axes); // axis set is fixed in v1 (no add/remove yet)

  function onRow(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === controller.colAxisId) controller.swap();
    else controller.rebind(id, controller.colAxisId);
  }
  function onCol(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === controller.rowAxisId) controller.swap();
    else controller.rebind(controller.rowAxisId, id);
  }
</script>

<div class="axis-binding">
  <label>
    <span>Rows</span>
    <select data-role="row-axis" value={controller.rowAxisId} onchange={onRow}>
      {#each axes as a (a.id)}
        <option value={a.id}>{a.name}</option>
      {/each}
    </select>
  </label>
  <button class="swap" type="button" title="swap row/column axes" onclick={() => controller.swap()}>
    ⇄
  </button>
  <label>
    <span>Cols</span>
    <select data-role="col-axis" value={controller.colAxisId} onchange={onCol}>
      {#each axes as a (a.id)}
        <option value={a.id}>{a.name}</option>
      {/each}
    </select>
  </label>
</div>

<style>
  .axis-binding {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #555;
  }
  select {
    font: inherit;
    padding: 1px 4px;
  }
  .swap {
    border: 1px solid #ccc;
    background: #fff;
    border-radius: 4px;
    padding: 1px 6px;
    cursor: pointer;
    line-height: 1.4;
  }
  .swap:hover {
    background: #f0f0f0;
  }
</style>
