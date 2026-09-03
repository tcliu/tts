import { detectTtsLanguage, SEGMENT_CJK_RE, SINGLE_CJK_RE, PUNCT_KEEP_RE, PUNCT_ONLY_RE, minimumLength } from '../detect'

export function splitTtsRuns(text: string) {
  const runs: { text: string; lang: string; start: number; end: number }[] = []
  let pendingWhitespace = ''
  let currentText = ''
  let currentCjk: boolean | null = null

  const flush = (endIndex: number) => {
    if (!currentText) return
    const start = endIndex - pendingWhitespace.length - currentText.length
    const lang = detectTtsLanguage(currentText)
    runs.push({ text: pendingWhitespace + currentText, lang, start, end: endIndex })
    pendingWhitespace = ''
    currentText = ''
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (/^\s$/.test(char)) {
      if (currentCjk === false) {
        currentText += char
      } else {
        flush(i)
        pendingWhitespace += char
      }
      continue
    }
    if (/\d/.test(char) && currentCjk !== null) {
      currentText += char
      continue
    }
    if (currentCjk && /[—─]/.test(char)) {
      currentText += char
      continue
    }
    if (currentCjk && (char === ',' || char === '.') && i + 1 < text.length && /\d/.test(text[i + 1])) {
      currentText += char
      continue
    }
    if (currentCjk !== null && currentText && PUNCT_KEEP_RE.test(char)) {
      currentText += char
      continue
    }
    const cjk = SEGMENT_CJK_RE.test(char)
    if (currentCjk === null || currentCjk === cjk) {
      currentCjk = cjk
      currentText += char
    } else {
      flush(i)
      currentCjk = cjk
      currentText = char
    }
  }
  flush(text.length)
  if (pendingWhitespace && runs.length > 0) {
    runs[runs.length - 1].text += pendingWhitespace
    runs[runs.length - 1].end = text.length
  }
  return reattachBracketEdges(runs)
}

export function reattachBracketEdges(
  runs: { text: string; lang: string; start: number; end: number }[],
): { text: string; lang: string; start: number; end: number }[] {
  if (runs.length < 2) return runs
  const OPEN_SUFFIX_RE = /[【「『（〈《]+$/
  const CLOSE_PREFIX_RE = /^[】」』）〉》]+[、]?/
  const out: { text: string; lang: string; start: number; end: number }[] = []
  for (let i = 0; i < runs.length; i += 1) {
    let run = runs[i]
    if (out.length > 0) {
      const prev = out[out.length - 1]
      const openMatch = prev.text.match(OPEN_SUFFIX_RE)
      if (openMatch) {
        const suffix = openMatch[0]
        const cut = suffix.length
        prev.text = prev.text.slice(0, -cut)
        prev.end -= cut
        run = { ...run, text: suffix + run.text, start: run.start - cut }
        if (prev.text.length === 0) out.pop()
      }
    }
    if (out.length > 0) {
      const closeMatch = run.text.match(CLOSE_PREFIX_RE)
      if (closeMatch) {
        const prefix = closeMatch[0]
        const cut = prefix.length
        const prev = out[out.length - 1]
        prev.text += prefix
        prev.end += cut
        run = { ...run, text: run.text.slice(cut), start: run.start + cut }
        if (run.text.length === 0) continue
      }
    }
    out.push(run)
  }
  return out
}

export function mergeAdjacentRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  const merged: { text: string; lang: string; start: number; end: number }[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && last.lang === run.lang) {
      last.text += run.text
      last.end = run.end
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

export function foldShortRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  const folded = [...runs]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < folded.length; i += 1) {
      const run = folded[i]
      const trimmed = run.text.trim()
      if (trimmed.length === 1 && SINGLE_CJK_RE.test(trimmed)) continue
      if (trimmed.length >= minimumLength(run.lang)) continue
      const prev = i > 0 ? folded[i - 1] : null
      const next = i < folded.length - 1 ? folded[i + 1] : null
      if (!prev && !next) continue
      const isPunctuationRun = PUNCT_ONLY_RE.test(trimmed)
      const target = isPunctuationRun
        ? prev
          ? i - 1
          : i + 1
        : !next || (prev && prev.text.length >= next.text.length)
          ? i - 1
          : i + 1
      if (target === i + 1) {
        folded[target].text = folded[i].text + folded[target].text
        folded[target].start = folded[i].start
      } else {
        folded[target].text += folded[i].text
        folded[target].end = folded[i].end
      }
      folded.splice(i, 1)
      changed = true
      break
    }
  }
  return mergeAdjacentRuns(folded)
}

export function mergeBracketedCjkPrefixes(runs: { text: string; lang: string; start: number; end: number }[]) {
  const merged = [...runs]
  for (let i = 0; i < merged.length - 1; i += 1) {
    const current = merged[i]
    const next = merged[i + 1]
    if (current.lang === 'en' && next.lang !== 'en' && /^[\[(<{\u300c\u300e\u3010][\d\s]+$/.test(current.text.trimStart())) {
      next.text = current.text + next.text
      next.start = current.start
      merged.splice(i, 1)
      i -= 1
    }
  }
  return merged
}

export function refineEnglishRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  return runs.map(run => {
    if (run.lang === 'en' && run.text.trim().length >= 10) {
      const refined = detectTtsLanguage(run.text)
      if (refined !== run.lang) return { ...run, lang: refined }
    }
    return run
  })
}

