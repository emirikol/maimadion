<script lang="ts">
  // Define a fiber from the active cell (tech-design §9, §14). Each axis is pinned to
  // the active cell's position unless you span it (free); the value is held constant
  // across every spanned axis. Surfaces the §9 create-time invariants: an overlap
  // with an existing fiber is rejected outright, while covering existing explicit
  // cells offers an absorb-on-overwrite. The component is mounted fresh each time the
  // dialog opens, so its state always reflects the current active cell.
  import { onMount } from 'svelte';
  import type { SheetController } from '../app/controller.svelte';

  let { controller }: { controller: SheetController } = $props();

  const axes = $derived(controller.sheet.axes);
  const activeCoord = $derived(controller.activeCoord()); // the pinned positions

  // Editable state, seeded from the active cell on mount (the dialog is mounted
  // fresh each open). Default: span the row axis — a value held constant down the
  // visible column.
  let freeAxes = $state(new Set<string>());
  let value = $state('');
  let error = $state<string | null>(null);
  let canAbsorb = $state(false); // a collision the user can resolve by overwriting

  let valueInput: HTMLInputElement | undefined = $state();

  const canCreate = $derived(freeAxes.size > 0); // a fiber spans ≥1 whole axis (§9)

  function toggleFree(id: string) {
    const next = new Set(freeAxes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    freeAxes = next;
    error = null;
    canAbsorb = false;
  }

  function create(absorb = false) {
    const result = controller.createFiber([...freeAxes], value, absorb);
    if (result.ok) return; // the controller closes the dialog on success
    if (result.reason === 'fiber-overlap') {
      error = 'Overlaps an existing constant — pick a different position or axes.';
      canAbsorb = false;
    } else {
      error = `${result.keys.length} existing cell(s) fall inside this constant.`;
      canAbsorb = true;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') controller.closeFlatDialog();
  }

  onMount(() => {
    freeAxes = new Set([controller.rowAxisId]);
    value = controller.activeText();
    valueInput?.focus();
  });
</script>

<svelte:window onkeydown={onKeyDown} />

<!-- Backdrop click cancels; clicks inside the panel don't bubble out to it. -->
<div
  class="backdrop"
  role="presentation"
  onpointerdown={() => controller.closeFlatDialog()}
>
  <div
    class="flat-dialog"
    role="dialog"
    tabindex="-1"
    aria-label="define constant"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <h2>Define a constant</h2>
    <p class="hint">
      Hold one value constant across whole axes. Spanned axes vary across the constant;
      the rest stay pinned at the active cell.
    </p>

    <fieldset>
      <legend>Span</legend>
      {#each axes as a (a.id)}
        <label class="axis-row">
          <input
            type="checkbox"
            data-axis={a.id}
            checked={freeAxes.has(a.id)}
            onchange={() => toggleFree(a.id)}
          />
          <span class="axis-name">{a.name}</span>
          {#if freeAxes.has(a.id)}
            <span class="span-note">spanned</span>
          {:else}
            <span class="pin-note">pinned at {activeCoord.get(a.id)}</span>
          {/if}
        </label>
      {/each}
    </fieldset>

    <label class="value">
      <span>Value</span>
      <input
        class="flat-value"
        bind:this={valueInput}
        bind:value
        spellcheck="false"
        autocomplete="off"
      />
    </label>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" onclick={() => controller.closeFlatDialog()}>Cancel</button>
      {#if canAbsorb}
        <button type="button" class="overwrite" onclick={() => create(true)}>Overwrite</button>
      {/if}
      <button type="button" class="create" disabled={!canCreate} onclick={() => create(false)}>
        Create
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  .flat-dialog {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    padding: 16px 20px;
    width: 320px;
    font: 13px system-ui, -apple-system, sans-serif;
    color: #1a1a1a;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 15px;
  }
  .hint {
    margin: 0 0 12px;
    color: #777;
    line-height: 1.4;
  }
  fieldset {
    border: 1px solid #e3e3e3;
    border-radius: 6px;
    margin: 0 0 12px;
    padding: 6px 10px 10px;
  }
  legend {
    color: #777;
    padding: 0 4px;
  }
  .axis-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
  }
  .axis-name {
    font-weight: 500;
  }
  .span-note {
    color: #1a73e8;
  }
  .pin-note {
    color: #999;
  }
  .value {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .value input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 3px 6px;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  .error {
    margin: 0 0 12px;
    color: #c5221f;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    font: inherit;
    padding: 4px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  .actions .create {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
  }
  .actions .create:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .actions .overwrite {
    border-color: #c5221f;
    color: #c5221f;
  }
</style>
