<script lang="ts">
  import { onMount } from 'svelte';
  import type { SheetController } from '../app/controller.svelte';
  import { contentSize, LAYOUT, render } from './render';

  let { controller }: { controller: SheetController } = $props();

  let viewport: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let scroller: HTMLDivElement;
  let editorEl: HTMLInputElement | undefined = $state();

  // Scroll offset and viewport size are the renderer's reactive inputs; the native
  // scroll container (with a sized spacer) remains the source of truth for scroll.
  let scrollLeft = $state(0);
  let scrollTop = $state(0);
  let vw = $state(0);
  let vh = $state(0);

  const content = $derived(contentSize(controller.sheet, controller.projection()));

  // The active cell's screen rect (CSS px, relative to .grid) — positions the editor.
  const editorRect = $derived.by(() => {
    const { rowH, colW, headerW, headerH } = LAYOUT;
    return {
      left: headerW + (controller.activeCol - 1) * colW - scrollLeft,
      top: headerH + (controller.activeRow - 1) * rowH - scrollTop,
      width: colW,
      height: rowH,
    };
  });

  function paint() {
    if (!canvas || vw === 0 || vh === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    render({
      ctx,
      cssWidth: vw,
      cssHeight: vh,
      dpr,
      scrollLeft,
      scrollTop,
      sheet: controller.sheet,
      view: controller.projection(),
      read: (coord) => controller.cellDisplay(coord),
      active: { row: controller.activeRow, col: controller.activeCol },
    });
  }

  // Repaint whenever any visual input changes (size, scroll, active cell, data rev,
  // or a view change — rebind/navigate, tracked via navVersion + the bound axes).
  $effect(() => {
    void [
      vw,
      vh,
      scrollLeft,
      scrollTop,
      controller.activeRow,
      controller.activeCol,
      controller.rev,
      controller.editing,
      controller.editSource,
      controller.rowAxisId,
      controller.colAxisId,
      controller.navVersion,
    ];
    paint();
  });

  /** Scroll the active cell fully into the body region (called after every move). */
  function ensureVisible() {
    const { rowH, colW, headerW, headerH } = LAYOUT;
    const bodyW = vw - headerW;
    const bodyH = vh - headerH;
    if (bodyW <= 0 || bodyH <= 0) return;
    const r = controller.activeRow - 1;
    const c = controller.activeCol - 1;
    let st = scrollTop;
    let sl = scrollLeft;
    if (r * rowH < st) st = r * rowH;
    else if ((r + 1) * rowH > st + bodyH) st = (r + 1) * rowH - bodyH;
    if (c * colW < sl) sl = c * colW;
    else if ((c + 1) * colW > sl + bodyW) sl = (c + 1) * colW - bodyW;
    st = Math.max(0, st);
    sl = Math.max(0, sl);
    if (st !== scrollTop || sl !== scrollLeft) {
      scrollTop = st;
      scrollLeft = sl;
      // Keep the native scrollbars in sync; onScroll reconciles any browser clamp.
      scroller.scrollTop = st;
      scroller.scrollLeft = sl;
    }
  }

  function onScroll() {
    scrollLeft = scroller.scrollLeft;
    scrollTop = scroller.scrollTop;
  }

  function onPointerDown(e: PointerEvent) {
    if (editorEl && e.target === editorEl) return; // caret placement inside the editor
    const { rowH, colW, headerW, headerH } = LAYOUT;
    const rect = viewport.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < headerW || py < headerH) return; // gutter/corner: no selection in M2
    const c = Math.floor((px - headerW + scrollLeft) / colW);
    const r = Math.floor((py - headerH + scrollTop) / rowH);
    if (r < 0 || c < 0 || r >= controller.rowCount || c >= controller.colCount) return;
    if (controller.editing) controller.commitEdit();
    controller.select(r + 1, c + 1);
    viewport.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (controller.editing) return; // the editor / formula bar own keys while editing
    const k = e.key;
    if (k === 'ArrowUp') controller.moveBy(-1, 0);
    else if (k === 'ArrowDown') controller.moveBy(1, 0);
    else if (k === 'ArrowLeft') controller.moveBy(0, -1);
    else if (k === 'ArrowRight') controller.moveBy(0, 1);
    else if (k === 'Tab') controller.moveBy(0, e.shiftKey ? -1 : 1);
    else if (k === 'Enter') controller.moveBy(e.shiftKey ? -1 : 1, 0);
    else if (k === 'Home') controller.home();
    else if (k === 'End') controller.end();
    else if (k === 'F2') controller.beginEdit();
    else if (k === 'Backspace' || k === 'Delete') controller.clearActive();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) controller.beginEdit(k);
    else return; // let the browser handle anything else
    e.preventDefault();
  }

  function onEditorKeyDown(e: KeyboardEvent) {
    const k = e.key;
    if (k === 'Enter') controller.commitEdit(e.shiftKey ? 'up' : 'down');
    else if (k === 'Tab') controller.commitEdit(e.shiftKey ? 'left' : 'right');
    else if (k === 'Escape') controller.cancelEdit();
    else return; // typing flows into the input
    e.preventDefault();
    e.stopPropagation(); // don't let the container re-handle the (now committed) key
  }

  // Focus the in-cell editor and put the caret at the end when a grid edit begins.
  $effect(() => {
    if (controller.editing && controller.editSource === 'grid' && editorEl) {
      editorEl.focus();
      const n = editorEl.value.length;
      editorEl.setSelectionRange(n, n);
    }
  });

  onMount(() => {
    controller.onEnsureVisible = ensureVisible;
    controller.onGridFocus = () => viewport?.focus();
    vw = viewport.clientWidth;
    vh = viewport.clientHeight;
    const ro = new ResizeObserver(() => {
      vw = viewport.clientWidth;
      vh = viewport.clientHeight;
    });
    ro.observe(viewport);
    viewport.focus();
    ensureVisible();
    return () => {
      ro.disconnect();
      controller.onEnsureVisible = undefined;
      controller.onGridFocus = undefined;
    };
  });
</script>

<!--
  The canvas is the visible surface, sized to the viewport. The scroll container
  sits on top, transparent, with a spacer sized to the full grid — so the browser
  supplies native scrollbars/momentum while the canvas repaints per scroll offset.
  The grid container is focusable and owns keyboard nav + click hit-testing; the
  positioned <input> is the in-cell editor overlay (§13).
-->
<div
  class="grid"
  bind:this={viewport}
  role="grid"
  tabindex="0"
  aria-label="spreadsheet grid"
  onpointerdown={onPointerDown}
  onkeydown={onKeyDown}
>
  <canvas bind:this={canvas}></canvas>
  <div class="scroll" bind:this={scroller} onscroll={onScroll}>
    <div class="spacer" style="width:{content.width}px; height:{content.height}px"></div>
  </div>
  {#if controller.editing && controller.editSource === 'grid'}
    <input
      class="cell-editor"
      bind:this={editorEl}
      bind:value={controller.editBuffer}
      onkeydown={onEditorKeyDown}
      style="left:{editorRect.left}px; top:{editorRect.top}px; width:{editorRect.width}px; height:{editorRect.height}px"
    />
  {/if}
</div>

<style>
  .grid {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    outline: none;
  }
  canvas {
    position: absolute;
    inset: 0;
  }
  .scroll {
    position: absolute;
    inset: 0;
    overflow: auto;
  }
  .spacer {
    pointer-events: none;
  }
  .cell-editor {
    position: absolute;
    box-sizing: border-box;
    margin: 0;
    padding: 0 5px;
    border: 2px solid #1a73e8;
    outline: none;
    font: 13px system-ui, -apple-system, sans-serif;
    background: #fff;
    color: #1a1a1a;
    z-index: 2;
  }
</style>
