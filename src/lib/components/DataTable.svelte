<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import Checkbox from './Checkbox.svelte'
  import Pagination from './Pagination.svelte'
  import SearchInput from './SearchInput.svelte'
  import Spinner from './Spinner.svelte'
  import SortAscIcon from '$lib/icons/SortAscIcon.svelte'
  import SortDescIcon from '$lib/icons/SortDescIcon.svelte'
  import { createColumnResize } from './use-column-resize.svelte'
  import { realignColumnWidths, resolveColumnWidths } from '$lib/data-table/column-helpers'

  export type SortDirection = 'asc' | 'desc'

  export interface DataTableColumn<T> {
    key: string
    header: string
    widthClass?: string
    minWidthClass?: string
    // Marks a numeric column: right-aligns the header (via the existing
    // `thead th.num` table style) alongside right-aligned numeric cells.
    // Suppressed when `headerAlign` is set, so an explicit alignment wins.
    num?: boolean
    // Header tooltip, rendered as `data-tip` so it uses the same custom
    // tooltip as Button's `dataTip` (the host handles `[data-tip]`).
    headerTip?: string
    // Header text alignment; cells keep their own alignment. Rendered as an
    // inline style (runtime values must not rely on generated utilities, and
    // an inline style wins over global element rules). Unset by default so
    // existing callers are unchanged. For a sortable center header the label
    // itself is centered and the two-arrow control is pinned to the header's
    // right edge, so the (usually invisible) arrows never pull the label off
    // center and hovering reveals them without shifting it. The label row
    // reserves right padding for the control width so a long label wraps
    // instead of sliding under the arrows.
    headerAlign?: 'left' | 'center' | 'right'
    // When widthClass / minWidthClass is omitted, they are derived from these:
    // a number is pixels, a string ending in '%' is a percentage (rebased so
    // percentage columns sum to 100%), any other string must be a valid CSS
    // length (e.g. '20rem'); malformed values are ignored and reported.
    width?: string | number
    minWidth?: string | number
    cellClass?: string
    cell?: Snippet<[T]>
    sortable?: boolean
    searchable?: boolean
  }

  interface Props<T> {
    rows: T[]
    rowId: (row: T) => string
    columns: DataTableColumn<T>[]
    loading?: boolean
    emptyMessage?: string
    searchValue?: string
    searchAriaLabel: string
    searchPlaceholder?: string
    showSearch?: boolean
    searchKeys?: string[]
    onSearchInput?: (event: Event) => void
    onSearchKeydown?: (event: KeyboardEvent) => void
    selectable?: boolean
    selectedIds?: Set<string>
    onToggleSelection?: (id: string, checked: boolean) => void
    onToggleAll?: () => void
    allSelected?: boolean
    someSelected?: boolean
    selectAllAriaLabel?: string
    rowSelectAriaLabel?: (row: T) => string
    total: number
    pageSize: number
    currentPage: number
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
    containerClass?: string
    tableClass?: string
    fillHeight?: boolean
    // Renders the pagination footer. Set false for short summary tables that
    // always fit one page (the dashboard breakdowns).
    showPagination?: boolean
    // Compact header/cell padding for summary tables embedded in a panel.
    // Applied inline so it also wins inside hosts whose global table rules are
    // unlayered (the legacy viewer stylesheet).
    dense?: boolean
    sortKey?: string | null
    sortDirection?: SortDirection
    onSort?: (key: string, direction: SortDirection) => void
    sortAriaLabel?: (column: DataTableColumn<T>, direction: SortDirection) => string
    resizeAriaLabel?: (column: DataTableColumn<T>) => string
    paginationPreviousLabel?: string
    paginationNextLabel?: string
    paginationPageSizeLabel?: string
    paginationCurrentLabel?: string
    paginationLabel?: string
    // Adds draggable (and arrow-key) resize handles to each data column header.
    // Off by default; the selectable checkbox column stays fixed.
    resizable?: boolean
    // When set, resized column widths are persisted to localStorage under this
    // key and restored on mount.
    storageKey?: string
    // Rising signal from the column chooser's reset action: each new value
    // drops managed widths (and their persisted copy) so the table falls
    // back to the percentage layout.
    resetWidthsSignal?: number
    // Escape-hatch renderer for callers that own cell HTML as strings (adapted
    // from the legacy viewer); used only when a column supplies no `cell`.
    renderCellHtml?: (columnKey: string, row: T) => string
  }

  let {
    rows,
    rowId,
    columns,
    loading = false,
    emptyMessage,
    searchValue = $bindable(''),
    searchAriaLabel,
    searchPlaceholder,
    showSearch = true,
    searchKeys = $bindable([] as string[]),
    onSearchInput,
    onSearchKeydown,
    selectable = false,
    selectedIds,
    onToggleSelection,
    onToggleAll,
    allSelected = false,
    someSelected = false,
    selectAllAriaLabel,
    rowSelectAriaLabel,
    total,
    pageSize,
    currentPage,
    onPageChange,
    onPageSizeChange,
    containerClass = 'max-h-[min(70vh,44rem)] overflow-auto rounded-xl border border-slate-800 bg-slate-950/50 contain-layout',
    tableClass = 'min-w-[60rem]',
    fillHeight = false,
    showPagination = true,
    dense = false,
    sortKey = $bindable(null as string | null),
    sortDirection = $bindable('asc' as SortDirection),
    onSort,
    sortAriaLabel,
    resizeAriaLabel,
    paginationPreviousLabel,
    paginationNextLabel,
    paginationPageSizeLabel,
    paginationCurrentLabel,
    paginationLabel,
    resizable = false,
    storageKey,
    resetWidthsSignal = 0,
    renderCellHtml,
  }: Props<T> = $props()

  const resolvedEmptyMessage = $derived(emptyMessage ?? 'No rows')
  const resolvedSearchPlaceholder = $derived(searchPlaceholder ?? 'Search')
  const resolvedSelectAllAriaLabel = $derived(selectAllAriaLabel ?? 'Select all')

  const columnCount = $derived(columns.length + (selectable ? 1 : 0))

  const FILL_CONTAINER_CLASS =
    'min-h-0 overflow-auto rounded-xl border border-slate-800 bg-slate-950/50 contain-layout'

  const resolvedColumns = $derived.by(() => resolveColumnWidths(columns))

  $effect(() => {
    const keys = columns.map(c => c.key)
    if (new Set(keys).size !== keys.length) {
      console.error('DataTable: duplicate column keys detected — each column key must be unique.', keys)
    }
  })

  $effect(() => {
    const keys = columns.filter(c => c.searchable).map(c => c.key)
    if (keys.join(',') !== searchKeys.join(',')) {
      searchKeys = keys
    }
  })

  // --- Column resize (opt-in via `resizable`) ---
  //
  // Each data column header hosts a splitter. Dragging the splitter between
  // columns i and i+1 re-partitions those two adjacent columns within a fixed
  // combined total; the splitter after the last column moves the table's right
  // edge. Widths are captured from the rendered table on the first resize, then
  // held in `columnWidths` (pixels per data column) with the table switched to
  // fixed layout via a sized `<colgroup>`.

  const MIN_COLUMN_WIDTH = 60
  const SELECT_COLUMN_WIDTH = 40

  // Pixel width per data column; empty until the first resize.
  let columnWidths = $state<number[]>([])
  // Column keys the widths above belong to. Widths are realigned by key
  // (not position) whenever the visible set changes, so toggling a column
  // never shifts its neighbours' widths.
  let widthKeys = $state<string[]>([])
  let tableContainer: HTMLElement | null = null
  let headerEls = $state<(HTMLElement | null)[]>([])

  const managedWidths = $derived(resizable && columnWidths.length > 0)

  const totalWidth = $derived.by(() => {
    let sum = selectable ? SELECT_COLUMN_WIDTH : 0
    for (let i = 0; i < columns.length; i++) {
      sum += columnWidths[i] ?? 0
    }
    return sum
  })

  function columnMinWidth(i: number): number {
    const mw = columns[i]?.minWidth
    return typeof mw === 'number' && Number.isFinite(mw) && mw >= 0 ? mw : MIN_COLUMN_WIDTH
  }

  // Width for a newly shown column: its declared percentage share of the
  // rendered table, so it comes back at the size the % layout would give it.
  function addedColumnWidth(key: string): number {
    const index = columns.findIndex(c => c.key === key)
    const declared = columns[index]?.width
    const pct =
      typeof declared === 'string' && declared.endsWith('%') ? Number.parseFloat(declared) : NaN
    const basis =
      tableContainer?.clientWidth ?? columnWidths.reduce((sum, w) => sum + w, 0)
    const computed = !Number.isNaN(pct) && basis > 0 ? Math.round((basis * pct) / 100) : 128
    return Math.max(computed, index >= 0 ? columnMinWidth(index) : MIN_COLUMN_WIDTH)
  }

  function getColumnCellWidth(i: number): number {
    return headerEls[i]?.offsetWidth ?? MIN_COLUMN_WIDTH
  }

  const resize = createColumnResize({
    getColumnCount: () => columns.length,
    getContainer: () => tableContainer,
    getColumnWidths: () => columnWidths,
    setColumnWidths: (widths: number[]) => {
      columnWidths = widths
    },
    getColumnCellWidth,
    getMinWidth: columnMinWidth,
    getFillWidthOffset: () => (selectable ? SELECT_COLUMN_WIDTH : 0),
    getStorageKey: () => storageKey,
  })

  // Keep columnWidths aligned with the current columns while the table is
  // in managed mode. Alignment is by column key: widths captured or
  // restored without keys are adopted only when they line up with the
  // current columns, and anything stale falls back to the % layout.
  $effect(() => {
    const keys = columns.map(c => c.key)
    const count = keys.length
    // bind:this grows headerEls but never shrinks it; drop stale tail refs
    // so a shrinking column list can't serve a detached header's width.
    if (headerEls.length > count) headerEls = headerEls.slice(0, count)
    if (count === 0) return
    if (columnWidths.length === 0) {
      if (widthKeys.length > 0) widthKeys = []
      return
    }
    if (widthKeys.length === 0) {
      if (columnWidths.length === count) widthKeys = keys
      else columnWidths = []
      return
    }
    if (widthKeys.length === count && widthKeys.every((k, i) => k === keys[i])) return
    columnWidths = realignColumnWidths(keys, widthKeys, columnWidths, addedColumnWidth)
    widthKeys = keys
  })

  // Restore persisted column widths on first mount so the user's splitter
  // positions survive a reload. loadPersistedWidths caches its result, so the
  // assignment below never re-fires.
  $effect(() => {
    const persisted = resize.loadPersistedWidths()
    if (persisted != null) columnWidths = persisted
  })

  // Width reset from the column chooser: forget manual adjustments in memory
  // and in storage. The realign effect below then sees empty widths and the
  // table renders the percentage layout again.
  let lastWidthReset = 0
  $effect(() => {
    if (resetWidthsSignal === lastWidthReset) return
    lastWidthReset = resetWidthsSignal
    columnWidths = []
    widthKeys = []
    resize.clearPersistedWidths()
  })

  function handleSortClick(column: DataTableColumn<T>, direction: SortDirection) {
    if (!column.sortable) {
      return
    }
    sortKey = column.key
    sortDirection = direction
    onSort?.(column.key, direction)
  }
</script>

<svelte:window onmouseup={resize.handleResizeMouseUp} onmousemove={resize.handleResizeMouseMove} />

<div class="flex flex-col gap-2 {fillHeight ? 'min-h-0 flex-1' : ''}">
  {#if showSearch}
    <SearchInput
      bind:value={searchValue}
      oninput={onSearchInput}
      onkeydown={onSearchKeydown}
      ariaLabel={searchAriaLabel}
      placeholder={resolvedSearchPlaceholder}
      wrapperClass={fillHeight ? 'shrink-0' : ''} />
  {/if}

  <div tabindex="-1" class={`${fillHeight ? FILL_CONTAINER_CLASS : containerClass} outline-none`} bind:this={tableContainer}>
    <table
      class="border-separate border-spacing-0 text-sm [&_tr:last-child_td]:border-b-0 {managedWidths ? 'min-w-full' : `w-full min-w-full ${tableClass}`}"
      style={managedWidths ? `table-layout:fixed;min-width:100%;width:${totalWidth}px;` : ''}>
      {#if managedWidths}
        <colgroup>
          {#if selectable}
            <col style="width:{SELECT_COLUMN_WIDTH}px;" />
          {/if}
          {#each Array.from({ length: columns.length }) as _, i}
            <col style="width:{columnWidths[i]}px;" />
          {/each}
        </colgroup>
      {/if}
      <thead>
        <tr class="text-left text-sm font-medium text-slate-400">
          {#if selectable}
            <th
              class="sticky top-0 z-10 w-10 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                ariaLabel={resolvedSelectAllAriaLabel}
                disabled={rows.length === 0}
                onChange={() => onToggleAll?.()} />
            </th>
          {/if}
          {#each resolvedColumns as column, i (column.key)}
            {@const isActive = sortKey === column.key}
            {@const isAsc = isActive && sortDirection === 'asc'}
            {@const isDesc = isActive && sortDirection === 'desc'}
            {@const headerAlignStyle =
              column.headerAlign === 'center' ? 'text-align: center'
              : column.headerAlign === 'right' ? 'text-align: right'
              : column.headerAlign === 'left' ? 'text-align: left'
              : ''}
            {@const centerHeader = column.headerAlign === 'center'}
            <th
              bind:this={headerEls[i]}
              class="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur {column.sortable ? 'group' : ''} {column.num ? 'num' : ''} {managedWidths ? '' : column.widthClass} {managedWidths ? '' : column.minWidthClass}"
              style={[headerAlignStyle, managedWidths ? '' : column.widthStyle, managedWidths ? '' : column.minWidthStyle, dense ? 'padding: 4px 8px; font-size: 12px' : ''].filter(Boolean).join('; ')}
              data-col-index={i}
              data-tip={column.headerTip ?? undefined}
              aria-sort={isActive ? (isAsc ? 'ascending' : 'descending') : undefined}>
              {#if column.sortable}
                <span class="flex w-full items-center gap-2 text-left {centerHeader ? 'relative justify-center pr-5' : ''}">
                  <span>{column.header}</span>
                  <span
                    class="{centerHeader ? 'absolute right-0 top-1/2 flex -translate-y-1/2 flex-col' : 'flex flex-col'} text-slate-400 transition-opacity {isActive ? 'opacity-100' : '[@media(hover:hover)]:opacity-0'} group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      class="leading-none outline-none transition-colors {isAsc ? 'text-cyan-400' : 'hover:text-cyan-300 focus:text-cyan-300'}"
                      aria-label={sortAriaLabel?.(column, 'asc') ?? `Sort ${column.header} ascending`}
                      onclick={() => handleSortClick(column, 'asc')}>
                      <SortAscIcon className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      class="-mt-1 leading-none outline-none transition-colors {isDesc ? 'text-cyan-400' : 'hover:text-cyan-300 focus:text-cyan-300'}"
                      aria-label={sortAriaLabel?.(column, 'desc') ?? `Sort ${column.header} descending`}
                      onclick={() => handleSortClick(column, 'desc')}>
                      <SortDescIcon className="h-2.5 w-2.5" />
                    </button>
                  </span>
                </span>
              {:else}
                {column.header}
              {/if}
              {#if resizable}
                <button
                  type="button"
                  class="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize border-0 bg-transparent p-0 outline-none hover:bg-cyan-500/40 focus-visible:bg-cyan-500/40"
                  style={i < columns.length - 1 ? 'right:-3px;' : 'right:0;'}
                  aria-label={resizeAriaLabel?.(column) ?? `Resize ${column.header}`}
                  onmousedown={event => resize.startColumnResize(event, i)}
                  onkeydown={event => resize.handleResizeKeydown(event, i)}></button>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if loading && rows.length === 0}
          <tr>
            <td colspan={columnCount} class="px-3 py-10">
              <div class="flex justify-center">
                <Spinner className="h-6 w-6" />
              </div>
            </td>
          </tr>
        {:else if rows.length === 0}
          <tr>
            <td colspan={columnCount} class="px-3 py-10 text-center text-sm text-slate-400">{resolvedEmptyMessage}</td>
          </tr>
        {:else}
          {#each rows as row (rowId(row))}
            <tr class="hover:bg-slate-900/40">
              {#if selectable}
                <td class="border-b border-slate-800/50 px-3 py-2">
                  <Checkbox
                    checked={selectedIds?.has(rowId(row)) ?? false}
                    ariaLabel={rowSelectAriaLabel?.(row) ?? 'Select row'}
                    onChange={checked => onToggleSelection?.(rowId(row), checked)} />
                </td>
              {/if}
              {#each resolvedColumns as column (column.key)}
                <td
                  class="border-b border-slate-800/50 px-3 py-2 {managedWidths ? '' : column.minWidthClass} {column.cellClass}"
                  style={[managedWidths ? '' : column.minWidthStyle, dense ? 'padding: 4px 8px; font-size: 12px' : ''].filter(Boolean).join('; ')}>
                  {@render column.cell?.(row)}
                  {#if !column.cell && renderCellHtml}{@html renderCellHtml(column.key, row)}{/if}
                </td>
              {/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  {#if showPagination}
    <div class="shrink-0">
      <Pagination
        {total}
        {pageSize}
        currentPage={currentPage}
        {onPageChange}
        {onPageSizeChange}
        previousLabel={paginationPreviousLabel}
        nextLabel={paginationNextLabel}
        pageSizeLabel={paginationPageSizeLabel}
        currentPageLabel={paginationCurrentLabel}
        paginationLabel={paginationLabel} />
    </div>
  {/if}
</div>
