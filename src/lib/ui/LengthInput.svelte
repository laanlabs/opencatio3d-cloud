<script lang="ts">
  import type { Units } from '../model/types';
  import { fmtLen, parseLen } from '../model/units';

  let { value, units, min = 0, max = 10000, onchange, disabled = false, label }:
    { value: number; units: Units; min?: number; max?: number; onchange: (m: number) => void; disabled?: boolean; label?: string } = $props();

  let text = $state('');
  let editing = $state(false);
  let bad = $state(false);
  const show = (v: number) => (units === 'imperial' ? fmtLen(v, units) : `${Math.round(v * 1000) / 1000} m`);
  $effect(() => { if (!editing) text = show(value); });

  function commit() {
    editing = false;
    const m = parseLen(text, units);
    if (m == null || m < min || m > max) { bad = true; text = show(value); setTimeout(() => (bad = false), 1200); return; }
    if (Math.abs(m - value) > 0.0005) onchange(Math.round(m * 1000) / 1000);
  }
</script>

<input
  class="len" class:bad type="text" inputmode="decimal" aria-label={label} {disabled}
  bind:value={text}
  onfocus={(e) => { editing = true; (e.currentTarget as HTMLInputElement).select(); }}
  onblur={commit}
  onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') { editing = false; text = show(value); (e.currentTarget as HTMLInputElement).blur(); } }}
  title="Type m, cm, ft or in (e.g. 2.4m, 36in, 8'6&quot;)"
/>

<style>
  .len { width: 100%; font-variant-numeric: tabular-nums; }
  .bad { border-color: var(--danger) !important; animation: shake .3s; }
  @keyframes shake { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
</style>
