<script lang="ts">
  import { formatClock } from '$lib/playback/timing'

  interface Props {
    displayValue: number
    totalDuration: number
    max: number
    progress: number
    disabled: boolean
    seekLabel: string
    onInput: (event: Event) => void
    onCommit: (event: Event) => void
  }

  let { displayValue, totalDuration, max, progress, disabled, seekLabel, onInput, onCommit }: Props = $props()
</script>

<div class="flex-none">
  <div class="flex items-center gap-3">
    <span class="w-11 flex-none select-none text-xs font-mono text-slate-400">{formatClock(displayValue)}</span>
    <div class="relative flex min-w-0 flex-1 items-center">
      <div
        class={`pointer-events-none absolute inset-x-2 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-slate-800 ${disabled ? 'opacity-50' : ''}`}>
        <div class="h-full rounded-full bg-sky-400" style={`width: ${progress}%`}></div>
      </div>
      <input
        type="range"
        min="0"
        max={String(max)}
        step="0.01"
        value={String(displayValue)}
        aria-label={seekLabel}
        aria-valuetext={`${formatClock(displayValue)} / ${formatClock(totalDuration)}`}
        disabled={disabled}
        oninput={onInput}
        onchange={onCommit}
        class="relative h-4 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent accent-cyan-500 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-default disabled:opacity-50" />
    </div>
    <span class="w-11 flex-none select-none text-right text-xs font-mono text-slate-400">{formatClock(totalDuration)}</span>
  </div>
</div>
