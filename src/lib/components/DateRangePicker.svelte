<script lang="ts">
  // Themed custom date-range picker. Replaces the two native
  // `<input type="date">` controls (whose calendar popup cannot follow the
  // theme) with a trigger + month-grid popover built on the shared dropdown
  // primitives: `positionPanel` portals and clamps the panel, `useDropdown`
  // owns outside-click/Escape, and `createFocusoutClose` closes when focus
  // leaves the picker.
  import { tick } from 'svelte'
  import { createFocusoutClose } from '$lib/actions/use-focusout-close'
  import { useDropdown } from '$lib/actions/use-dropdown.svelte'
  import { positionPanel } from '$lib/position-panel.svelte'
  import { NATIVE_SELECT_BUTTON_CLASS } from '$lib/dropdown-chrome'
  import CalendarIcon from '$lib/icons/CalendarIcon.svelte'
  import ChevronLeftIcon from '$lib/icons/ChevronLeftIcon.svelte'
  import ChevronRightIcon from '$lib/icons/ChevronRightIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  const i18n = getI18nContext()

  interface Props {
    from: string
    to: string
    onFrom: (value: string) => void
    onTo: (value: string) => void
  }

  let { from, to, onFrom, onTo }: Props = $props()

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const DAY_STEP: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`
  const yearOf = (value: string) => Number(value.slice(0, 4))
  const monthOf = (value: string) => Number(value.slice(5, 7)) - 1
  const dayOf = (value: string) => Number(value.slice(8, 10))
  const daysInMonth = (year: number, month: number) =>
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const weekdayOf = (value: string) =>
    new Date(Date.UTC(yearOf(value), monthOf(value), dayOf(value))).getUTCDay()

  function todayIso(): string {
    const now = new Date()
    return iso(now.getFullYear(), now.getMonth(), now.getDate())
  }
  function addDays(value: string, delta: number): string {
    const date = new Date(Date.UTC(yearOf(value), monthOf(value), dayOf(value) + delta))
    return iso(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  }
  function clampToMonth(year: number, month: number, day: number): string {
    const nextYear = year + Math.floor(month / 12)
    const nextMonth = ((month % 12) + 12) % 12
    return iso(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)))
  }

  // Invalid dates are treated as unset rather than poisoning comparisons.
  const start = $derived(DATE_RE.test(from) ? from : '')
  const end = $derived(DATE_RE.test(to) ? to : '')

  let open = $state(false)
  let viewYear = $state(new Date().getFullYear())
  let viewMonth = $state(new Date().getMonth())
  let focusDay = $state(todayIso())
  let containerRef = $state<HTMLDivElement | null>(null)
  let panelRef = $state<HTMLDivElement | null>(null)
  let triggerRef = $state<HTMLButtonElement | null>(null)

  // Re-anchor the visible month and the roving focus to the committed range
  // whenever the picker is closed and the range changes (external update,
  // Clear, reset).
  $effect(() => {
    if (open) return
    const anchor = start || end || todayIso()
    viewYear = yearOf(anchor)
    viewMonth = monthOf(anchor)
    focusDay = anchor
  })

  const dateFormat = $derived(
    new Intl.DateTimeFormat(i18n.locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }),
  )
  const monthFormat = $derived(
    new Intl.DateTimeFormat(i18n.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  )
  const numberFormat = $derived(new Intl.NumberFormat(i18n.locale))
  const weekdayLabels = $derived(
    Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(i18n.locale, { weekday: 'short', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2024, 0, 7 + index)),
      ),
    ),
  )

  const monthLabel = $derived(monthFormat.format(new Date(Date.UTC(viewYear, viewMonth, 1))))

  const weeks = $derived.by(() => {
    const leading = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay()
    const total = daysInMonth(viewYear, viewMonth)
    const cells: { day: string | null; label: number; aria: string }[] = []
    for (let i = 0; i < leading; i++) cells.push({ day: null, label: 0, aria: '' })
    for (let d = 1; d <= total; d++) {
      const day = iso(viewYear, viewMonth, d)
      cells.push({
        day,
        label: d,
        aria: dateFormat.format(new Date(Date.UTC(viewYear, viewMonth, d))),
      })
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, label: 0, aria: '' })
    const rows: (typeof cells)[] = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  })

  const triggerLabel = $derived(
    start && end
      ? `${start} – ${end}`
      : start
        ? `${start} – …`
        : end
          ? `… – ${end}`
          : i18n.t('range.selectDates'),
  )

  const dayNodes = new Map<string, HTMLButtonElement>()
  function dayRef(node: HTMLButtonElement, day: string) {
    dayNodes.set(day, node)
    return {
      destroy() {
        dayNodes.delete(day)
      },
    }
  }

  const isStart = (day: string) => day === start
  const isEnd = (day: string) => day === end
  const inRange = (day: string) => !!start && !!end && day > start && day < end

  function close(restoreFocus = false) {
    if (!open) return
    open = false
    if (restoreFocus) void tick().then(() => triggerRef?.focus())
  }

  function openPanel() {
    const anchor = start || end || todayIso()
    viewYear = yearOf(anchor)
    viewMonth = monthOf(anchor)
    focusDay = anchor
    open = true
    // The panel is portalled and rendered after the flush; focus the selected
    // (or today's) day once its button exists.
    void tick().then(() => dayNodes.get(anchor)?.focus())
  }

  function toggle() {
    if (open) close()
    else openPanel()
  }

  function selectDay(day: string) {
    if (!start) {
      onFrom(day)
      focusDay = day
      return
    }
    if (!end) {
      // Read the current start before emitting: the prop updates only after
      // the parent re-renders.
      const previous = start
      if (day < previous) {
        onFrom(day)
        onTo(previous)
      } else {
        onTo(day)
      }
      close(true)
      return
    }
    // Both ends set: begin a new range at the clicked day.
    onFrom(day)
    onTo('')
    focusDay = day
  }

  function clear() {
    onFrom('')
    onTo('')
  }

  async function focusOn(day: string) {
    focusDay = day
    if (yearOf(day) !== viewYear || monthOf(day) !== viewMonth) {
      viewYear = yearOf(day)
      viewMonth = monthOf(day)
      await tick()
    }
    dayNodes.get(day)?.focus()
  }

  function onDayKeydown(event: KeyboardEvent, day: string) {
    const step = DAY_STEP[event.key]
    if (step !== undefined) {
      event.preventDefault()
      void focusOn(addDays(day, step))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const weekday = weekdayOf(day)
      void focusOn(addDays(day, event.key === 'Home' ? -weekday : 6 - weekday))
      return
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      void focusOn(clampToMonth(yearOf(day), monthOf(day) + (event.key === 'PageDown' ? 1 : -1), dayOf(day)))
    }
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault()
      openPanel()
    }
  }

  function prevMonth() {
    if (viewMonth === 0) {
      viewMonth = 11
      viewYear--
    } else {
      viewMonth--
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      viewMonth = 0
      viewYear++
    } else {
      viewMonth++
    }
  }

  const handleFocusOut = createFocusoutClose(
    () => open,
    () => ({ container: containerRef, panel: panelRef }),
    () => close(),
  )

  useDropdown(() => ({
    isOpen: () => open,
    container: () => containerRef,
    onOutsideClick: () => close(),
    onEscape: () => {
      close(true)
    },
    panel: () => panelRef,
  }))
</script>

<div class="relative" bind:this={containerRef} onfocusout={handleFocusOut}>
  <button
    type="button"
    bind:this={triggerRef}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={`${i18n.t('range.selectDates')}: ${triggerLabel}`}
    onclick={toggle}
    onkeydown={onTriggerKeydown}
    class={`${NATIVE_SELECT_BUTTON_CLASS} ${start || end ? 'text-slate-100!' : 'text-slate-500!'}`}>
    <span class="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
    <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
  </button>

  {#if open}
    <div
      bind:this={panelRef}
      role="dialog"
      aria-label={i18n.t('range.calendar')}
      use:positionPanel={() => ({
        getTrigger: () => triggerRef,
        getOpen: () => open,
        align: 'left',
        autoPlace: true,
      })}
      class="fixed left-0 top-0 z-40 w-[17rem] max-w-[calc(100vw-1rem)] rounded-lg border border-slate-700 bg-slate-900/95 p-2 shadow-2xl shadow-slate-950/60 backdrop-blur">
      <div class="mb-1.5 flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={i18n.t('range.prevMonth')}
          onclick={prevMonth}
            class="flex h-7 w-7 items-center justify-center rounded-md text-slate-400! outline-none transition hover:bg-slate-800 hover:text-cyan-300! motion-reduce:transition-none">
            <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span class="text-xs font-semibold text-slate-200">{monthLabel}</span>
        <button
          type="button"
          aria-label={i18n.t('range.nextMonth')}
          onclick={nextMonth}
            class="flex h-7 w-7 items-center justify-center rounded-md text-slate-400! outline-none transition hover:bg-slate-800 hover:text-cyan-300! motion-reduce:transition-none">
            <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div class="grid grid-cols-7 gap-1" role="grid" aria-label={i18n.t('range.calendar')}>
        <div class="contents" role="row">
          {#each weekdayLabels as label}
              <div role="columnheader" class="py-0.5 text-center text-[10px] font-semibold uppercase text-slate-500">
              {label}
            </div>
          {/each}
        </div>
        {#each weeks as week}
          <div class="contents" role="row">
            {#each week as cell, ci (cell.day ?? `blank-${ci}`)}
              <div
                role="gridcell"
                aria-selected={cell.day ? isStart(cell.day) || isEnd(cell.day) : undefined}
                class="flex justify-center">
                {#if cell.day}
                  {@const selected = isStart(cell.day) || isEnd(cell.day)}
                  {@const between = inRange(cell.day)}
                  <button
                    type="button"
                    use:dayRef={cell.day}
                    tabindex={cell.day === focusDay ? 0 : -1}
                    aria-label={cell.aria}
                    aria-current={cell.day === todayIso() ? 'date' : undefined}
                    onclick={() => selectDay(cell.day as string)}
                    onkeydown={event => onDayKeydown(event, cell.day as string)}
                    class={`flex h-8 w-8 items-center justify-center rounded-md text-xs! outline-none transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                      selected
                        ? 'bg-cyan-500 font-semibold text-onaccent!'
                        : between
                          ? 'bg-cyan-500/15 text-cyan-100!'
                          : cell.day === todayIso()
                            ? 'font-semibold text-cyan-300! hover:bg-slate-800'
                            : 'text-slate-300! hover:bg-slate-800 hover:text-slate-100!'
                    }`}>
                    {numberFormat.format(cell.label)}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>

      <div class="mt-1.5 flex items-center justify-between border-t border-slate-800 pt-1.5">
        <span class="min-w-0 truncate text-[11px] text-slate-500">{triggerLabel}</span>
        <button
          type="button"
          disabled={!start && !end}
          onclick={clear}
          class="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-slate-500! outline-none transition hover:text-rose-300! disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none">
          {i18n.t('range.clear')}
        </button>
      </div>
    </div>
  {/if}
</div>
