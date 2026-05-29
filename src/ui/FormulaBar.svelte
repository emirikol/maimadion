<script lang="ts">
  import type { SheetController } from '../app/controller.svelte';

  let { controller }: { controller: SheetController } = $props();

  // The name box shows the active cell's fully-qualified address (§4); the input
  // mirrors the active cell — its committed text, or the live edit buffer (§14).
  const address = $derived.by(() => {
    void [controller.activeRow, controller.activeCol, controller.navVersion];
    return controller.activeAddress();
  });
  const value = $derived.by(() => {
    if (controller.editing) return controller.editBuffer;
    void [controller.rev, controller.activeRow, controller.activeCol, controller.navVersion];
    return controller.activeText();
  });

  function onFocus() {
    if (!controller.editing) controller.beginEdit(undefined, 'bar');
  }
  function onInput(e: Event) {
    if (!controller.editing) controller.beginEdit('', 'bar');
    controller.editBuffer = (e.currentTarget as HTMLInputElement).value;
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') controller.commitEdit('down');
    else if (e.key === 'Escape') controller.cancelEdit();
    else return;
    e.preventDefault();
  }
</script>

<div class="formula-bar">
  <span class="name-box">{address}</span>
  <input
    class="formula-input"
    {value}
    onfocus={onFocus}
    oninput={onInput}
    onkeydown={onKeyDown}
    spellcheck="false"
    autocomplete="off"
    aria-label="formula bar"
  />
</div>

<style>
  .formula-bar {
    display: flex;
    align-items: stretch;
    height: 28px;
    border-bottom: 1px solid #ddd;
    font: 13px system-ui, -apple-system, sans-serif;
  }
  .name-box {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    padding: 0 8px;
    border-right: 1px solid #ddd;
    color: #333;
    background: #fafafa;
  }
  .formula-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    padding: 0 8px;
    font: inherit;
    color: #1a1a1a;
  }
</style>
