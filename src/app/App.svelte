<script lang="ts">
  import Grid from '../grid/Grid.svelte';
  import { createSeedSheet } from '../model/sheet';

  const sheet = createSeedSheet();
</script>

<div class="app">
  <header>
    <h1>maimadion</h1>
    <span>M1 — static grid</span>
  </header>
  <div class="grid-host">
    <Grid {sheet} />
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
