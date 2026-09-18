<script lang="ts">
  import NumberInput from './NumberInput.svelte'
  import SelectDropdown from './SelectDropdown.svelte'
  import ChevronLeftIcon from '$lib/icons/ChevronLeftIcon.svelte'
  import ChevronRightIcon from '$lib/icons/ChevronRightIcon.svelte'
  import { getI18nContext } from '$lib/i18n.svelte'
  const i18n = getI18nContext()

  interface Props {
    total: number
    pageSize: number
    currentPage: number
    size?: 'xs' | 'sm' | 'md' | 'lg'
    className?: string
    pageSizeOptions?: number[]
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
    previousLabel?: string
    nextLabel?: string
    pageSizeLabel?: string
    currentPageLabel?: string
    paginationLabel?: string
  }

  let {
    total,
    pageSize,
    currentPage,
    size = 'sm',
    className = '',
    pageSizeOptions = [10, 20, 50],
    onPageChange,
    onPageSizeChange,
    previousLabel,
    nextLabel,
    pageSizeLabel,
    currentPageLabel,
    paginationLabel,
  }: Props = $props()

  // Derived (not plain consts) so locale switches re-resolve the labels.
  const resolvedPreviousLabel = $derived(previousLabel ?? i18n.t('pagination.previous'))
  const resolvedNextLabel = $derived(nextLabel ?? i18n.t('pagination.next'))
  const resolvedPageSizeLabel = $derived(pageSizeLabel ?? i18n.t('pagination.pageSize'))
  const resolvedCurrentPageLabel = $derived(currentPageLabel ?? i18n.t('pagination.current'))
  const resolvedPaginationLabel = $derived(paginationLabel ?? i18n.t('pagination.label'))

  const PAGE_JUMP_DELTA = 2

  const SIZE_CLASS = {
    xs: {
      iconButton: 'h-8 w-8',
      pageButton: 'h-8 min-w-8 px-2',
      pageInput: 'h-8 min-w-8',
      pageInputPad: '0.5rem',
      text: 'text-xs',
      icon: 'h-4 w-4',
    },
    sm: {
      iconButton: 'h-9 w-9',
      pageButton: 'h-9 min-w-9 px-2.5',
      pageInput: 'h-9 min-w-9',
      pageInputPad: '0.625rem',
      text: 'text-sm',
      icon: 'h-4 w-4',
    },
    md: {
      iconButton: 'h-10 w-10',
      pageButton: 'h-10 min-w-10 px-3',
      pageInput: 'h-10 min-w-10',
      pageInputPad: '0.75rem',
      text: 'text-md',
      icon: 'h-5 w-5',
    },
    lg: {
      iconButton: 'h-11 w-11',
      pageButton: 'h-11 min-w-11 px-3.5',
      pageInput: 'h-11 min-w-11',
      pageInputPad: '0.875rem',
      text: 'text-lg',
      icon: 'h-5 w-5',
    },
  } as const

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)))
  const canGoPrev = $derived(currentPage > 1)
  const canGoNext = $derived(currentPage < totalPages)

  const pageNumbers = $derived.by(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1)
    }
    const end = Math.min(totalPages, currentPage + PAGE_JUMP_DELTA)
    const start = Math.max(1, end - PAGE_JUMP_DELTA * 2)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  })

  const showStartEllipsis = $derived(pageNumbers[0] > 1)
  const showEndEllipsis = $derived(pageNumbers[pageNumbers.length - 1] < totalPages)

  const iconButtonClass = $derived(
    `relative inline-flex ${SIZE_CLASS[size].iconButton} items-center justify-center rounded-md border border-slate-700 bg-slate-950 font-semibold text-slate-100 outline-none transition hover:border-cyan-500 hover:text-cyan-300 focus:border-cyan-500 focus:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40`,
  )

  const pageButtonClass = $derived(
    `relative inline-flex ${SIZE_CLASS[size].pageButton} items-center justify-center rounded-md border border-slate-700 bg-slate-950 font-semibold text-slate-100 outline-none transition hover:border-cyan-500 hover:text-cyan-300 focus:border-cyan-500 focus:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40`,
  )

  let pageJumpInputValue = $state('')
  let pageJumpInput = $state<{ focus: () => void } | null>(null)
  // Set only by an Enter commit that actually navigates: the focused input
  // unmounts on navigation, so the effect below carries focus to the new
  // page's input. Mouse navigation never sets it and never steals focus.
  let refocusJumpInput = false
  let refocusFrame = 0

  $effect(() => {
    pageJumpInputValue = String(currentPage)
  })

  $effect(() => {
    currentPage
    pageJumpInput
    if (!refocusJumpInput) return
    refocusJumpInput = false
    // Cancel any pending frame before scheduling a new one, and skip when
    // focus already moved on, so a fast Tab is never overridden.
    cancelAnimationFrame(refocusFrame)
    refocusFrame = requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return
      pageJumpInput?.focus()
    })
  })

  // Width for the jump input: the widest page number plus the text being
  // typed, with the buttons' padding and border and a 2px caret allowance —
  // the same box as the page buttons, never clipped. Inline style because
  // runtime widths must not be utilities.
  const pageInputDigits = $derived(Math.max(1, String(totalPages).length, pageJumpInputValue.length))
  const pageInputStyle = $derived.by(() => {
    const pad = SIZE_CLASS[size].pageInputPad
    return `padding-left:${pad};padding-right:${pad};width:calc(${pageInputDigits}ch + 2 * ${pad} + 4px)`
  })

  function goToPage(page: number) {
    if (page < 1 || page > totalPages || page === currentPage) {
      return
    }
    onPageChange(page)
  }

  function changePageBy(delta: number) {
    goToPage(currentPage + delta)
  }

  // Commit the typed page; returns whether it navigated. Enter uses the result
  // to refocus the new input, blur discards it and only commits.
  function commitPageInput(): boolean {
    const parsed = Number.parseInt(pageJumpInputValue, 10)
    if (Number.isNaN(parsed)) {
      pageJumpInputValue = String(currentPage)
      return false
    }
    const clamped = Math.min(Math.max(parsed, 1), totalPages)
    if (clamped === currentPage) {
      pageJumpInputValue = String(currentPage)
      return false
    }
    onPageChange(clamped)
    return true
  }

  function handlePageInputBlur() {
    commitPageInput()
  }

  function handlePageInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      refocusJumpInput = commitPageInput()
    } else if (event.key === 'Escape') {
      pageJumpInputValue = String(currentPage)
    }
  }

  function handlePageSizeChange(value: string) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== pageSize) {
      onPageSizeChange(parsed)
    }
  }
</script>

<nav aria-label={resolvedPaginationLabel} class="flex flex-wrap items-center gap-1.5 {SIZE_CLASS[size].text} text-slate-400 {className}">
  <button
    type="button"
    aria-label={resolvedPreviousLabel}
    disabled={!canGoPrev}
    onclick={() => changePageBy(-1)}
    class={iconButtonClass}>
    <ChevronLeftIcon className={SIZE_CLASS[size].icon} />
  </button>

  {#if showStartEllipsis}
    <button type="button" onclick={() => goToPage(1)} class={pageButtonClass}>1</button>
    <span class={`inline-flex ${SIZE_CLASS[size].pageButton} items-center justify-center font-semibold text-slate-500`}>…</span>
  {/if}

  {#each pageNumbers as pageNum (pageNum)}
    {#if pageNum === currentPage}
      <NumberInput
        bind:this={pageJumpInput}
        bind:value={pageJumpInputValue}
        min={1}
        max={totalPages}
        inputStyle={pageInputStyle}
        onblur={handlePageInputBlur}
        onkeydown={handlePageInputKeydown}
        ariaLabel={resolvedCurrentPageLabel}
        showControls={false}
        className={`${SIZE_CLASS[size].pageInput} rounded-md border border-cyan-500 bg-slate-950 text-center ${SIZE_CLASS[size].text} font-semibold text-cyan-300 outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-500/40`} />
    {:else}
      <button type="button" onclick={() => goToPage(pageNum)} class={pageButtonClass}>{pageNum}</button>
    {/if}
  {/each}

  {#if showEndEllipsis}
    <span class={`inline-flex ${SIZE_CLASS[size].pageButton} items-center justify-center font-semibold text-slate-500`}>…</span>
    <button type="button" onclick={() => goToPage(totalPages)} class={pageButtonClass}>{totalPages}</button>
  {/if}

  <button
    type="button"
    aria-label={resolvedNextLabel}
    disabled={!canGoNext}
    onclick={() => changePageBy(1)}
    class={iconButtonClass}>
    <ChevronRightIcon className={SIZE_CLASS[size].icon} />
  </button>

  <div class="flex items-center gap-1.5">
    <span>{resolvedPageSizeLabel}</span>
    <div class="relative">
      <SelectDropdown
      buttonLabel={String(pageSize)}
      activeValue={String(pageSize)}
      ariaLabel={resolvedPageSizeLabel}
      size={size}
      options={pageSizeOptions.map(size => ({ value: String(size), label: String(size) }))}
      onSelect={handlePageSizeChange}
      emptyLabel={i18n.t('dropdown.noOptions')} />
    </div>
  </div>
</nav>
