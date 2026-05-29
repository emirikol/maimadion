<script lang="ts">
  // A navigator for one hidden axis (tech-design §14): drag to move the navigated
  // position along that dimension; the visible slice re-projects, the active cell
  // stays on its screen position. (The handle-doubles-as-fill affordance is a later
  // milestone — M9; here it only navigates.)
  import type { Axis } from '../engine/types';
  import type { SheetController } from '../app/controller.svelte';

  let { controller, axis }: { controller: SheetController; axis: Axis } = $props();

  const count = $derived(axis.positions.length); // fixed in v1 (no insert/delete until M9)
  const index = $derived(controller.navigatedIndex(axis.id));

  function onInput(e: Event) {
    controller.navigate(axis.id, Number((e.currentTarget as HTMLInputElement).value));
  }
</script>

<label class="navigator" data-axis={axis.id}>
  <span class="nav-name">{axis.name}</span>
  <input
    type="range"
    min="1"
    max={count}
    step="1"
    value={index}
    oninput={onInput}
    aria-label={`navigate ${axis.name}`}
  />
  <span class="nav-readout">{index} / {count}</span>
</label>

<style>
  .navigator {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #555;
  }
  .nav-name {
    font-weight: 500;
  }
  input[type='range'] {
    width: 120px;
  }
  .nav-readout {
    min-width: 40px;
    font-variant-numeric: tabular-nums;
    color: #888;
  }
</style>
