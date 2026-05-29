<script lang="ts">
  import { onMount } from 'svelte';
  import type { Sheet } from '../engine/types';
  import { contentSize, render } from './render';

  let { sheet }: { sheet: Sheet } = $props();

  let viewport: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let scroller: HTMLDivElement;

  const content = $derived(contentSize(sheet));

  function paint() {
    if (!canvas || !viewport) return;
    const cssWidth = viewport.clientWidth;
    const cssHeight = viewport.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    render({
      ctx,
      cssWidth,
      cssHeight,
      dpr,
      scrollLeft: scroller?.scrollLeft ?? 0,
      scrollTop: scroller?.scrollTop ?? 0,
      sheet,
    });
  }

  onMount(() => {
    paint();
    const ro = new ResizeObserver(() => paint());
    ro.observe(viewport);
    return () => ro.disconnect();
  });
</script>

<!--
  The canvas is the visible surface, sized to the viewport. The scroll container
  sits on top, transparent, with a spacer sized to the full grid — so the browser
  supplies native scrollbars/momentum while the canvas repaints per scroll offset.
-->
<div class="grid" bind:this={viewport}>
  <canvas bind:this={canvas}></canvas>
  <div class="scroll" bind:this={scroller} onscroll={paint}>
    <div class="spacer" style="width:{content.width}px; height:{content.height}px"></div>
  </div>
</div>

<style>
  .grid {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
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
</style>
