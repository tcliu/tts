const STORAGE_KEY_PREFIX = 'tts:column-widths:'

const DEFAULT_WIDTH = 128

function clampWidths(widths: number[]): number[] {
  return widths.map(w => {
    if (!Number.isFinite(w) || w < 0) {
      return DEFAULT_WIDTH
    }
    return Math.round(w)
  })
}

export function loadColumnWidths(key: string): number[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + key)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return clampWidths(parsed.filter((w): w is number => typeof w === 'number'))
  } catch (error) {
    console.error('Failed to load column widths from localStorage', { key, error })
    return null
  }
}

export function saveColumnWidths(key: string, widths: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(clampWidths(widths)))
  } catch (error) {
    console.error('Failed to save column widths to localStorage', { key, error })
  }
}
