export const CSS_LENGTH_RE = /^\d+(\.\d+)?(px|rem|em|ch|vw|vh|fr)$/

export function invalidWidth(key: string, value: string | number, property: 'width' | 'min-width'): void {
  console.error(
    `DataTable: ignoring invalid ${property} for column "${key}" — use a number of pixels or a string ending in "%" (or a valid CSS length).`,
    value,
  )
}

export type ResolvedColumn<T> = T & {
  widthStyle?: string
  minWidthStyle?: string
}

export function resolveColumnWidths<T extends { key: string; widthClass?: string; minWidthClass?: string; width?: string | number; minWidth?: string | number }>(
  columns: T[],
): ResolvedColumn<T>[] {
  const pctWidthColumns = columns.filter(
    c =>
      c.widthClass === undefined &&
      typeof c.width === 'string' &&
      c.width.endsWith('%') &&
      !Number.isNaN(Number.parseFloat(c.width)),
  )
  const pctSum = pctWidthColumns.reduce((sum, c) => sum + Number.parseFloat(c.width as string), 0)
  const rebaseFactor = pctSum > 0 ? 100 / pctSum : 1

  return columns.map(column => {
    let widthStyle: string | undefined
    if (column.widthClass === undefined && column.width !== undefined) {
      if (typeof column.width === 'number') {
        if (Number.isFinite(column.width) && column.width >= 0) {
          widthStyle = `width: ${column.width}px`
        } else {
          invalidWidth(column.key, column.width, 'width')
        }
      } else if (column.width.endsWith('%')) {
        const pct = Number.parseFloat(column.width)
        if (Number.isNaN(pct)) {
          invalidWidth(column.key, column.width, 'width')
        } else {
          widthStyle = `width: ${(pct * rebaseFactor).toFixed(2)}%`
        }
      } else if (CSS_LENGTH_RE.test(column.width)) {
        widthStyle = `width: ${column.width}`
      } else {
        invalidWidth(column.key, column.width, 'width')
      }
    }

    let minWidthStyle: string | undefined
    if (column.minWidthClass === undefined && column.minWidth !== undefined) {
      if (typeof column.minWidth === 'number' && Number.isFinite(column.minWidth) && column.minWidth >= 0) {
        minWidthStyle = `min-width: ${column.minWidth}px`
      } else if (typeof column.minWidth === 'string' && (column.minWidth.endsWith('%') || CSS_LENGTH_RE.test(column.minWidth))) {
        minWidthStyle = `min-width: ${column.minWidth}`
      } else {
        invalidWidth(column.key, column.minWidth, 'min-width')
      }
    }

    return { ...column, widthStyle, minWidthStyle }
  })
}
