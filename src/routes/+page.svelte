<script lang="ts">
  import { onMount } from 'svelte'
  import CodeEditor from '$lib/components/CodeEditor.svelte'
  import Button from '$lib/components/Button.svelte'
  import SettingsDialog from '$lib/components/SettingsDialog.svelte'
  import GlobeIcon from '$lib/icons/GlobeIcon.svelte'
  import SettingsIcon from '$lib/icons/SettingsIcon.svelte'
  import InfoIcon from '$lib/icons/InfoIcon.svelte'
  import FollowIcon from '$lib/icons/FollowIcon.svelte'
  import SpeakerIcon from '$lib/icons/SpeakerIcon.svelte'
  import StopIcon from '$lib/icons/StopIcon.svelte'

  import { positionPanel } from '$lib/position-panel.svelte'
  import { UI_LANGUAGE_OPTIONS, UI_TEXT, type UiLocale } from '$lib/ui-text'
  import { synthesisCacheKey } from '$lib/tts-cache-key'
  import {
    SPEEDS,
    activeHighlightRange,
    defaultGroupByLanguage,
    defaultVoiceByLanguage,
    splitHighlightRanges,
    splitTtsSegments,
    type HighlightRange,
    type TtsBoundary,
    voiceForSelection,
  } from '$lib/tts-reference'

  type CodeEditorHandle = {
    getSelectionText: () => string
    getSelectionRange: () => { from: number; to: number } | null
    setSelection: (from: number, to: number) => boolean
    clearSelection: () => void
    focus: () => void
  }

  type LaunchedSegment = {
    blob: Blob
    boundaries: TtsBoundary[]
    rate: number
    voiceName: string
  }

  type SegmentMeta = {
    index: number
    lang: string
    text: string
    ranges: HighlightRange[]
    boundaries: TtsBoundary[]
    baseOffset: number
    duration?: number
  }

  interface PlaybackController {
    cancelled: boolean
  }

  const STORAGE_KEY = 'tts:web-settings'

  let locale = $state<UiLocale>('en')
  let content = $state('')
  let speed = $state<number>(1)
  let synthesisConcurrency = $state<number>(4)
  let voiceSelections = $state<Record<string, string>>(defaultVoiceByLanguage())
  let groupSelections = $state<Record<string, string>>(defaultGroupByLanguage())
  let statusMessage = $state(UI_TEXT.en.ready)
  let settingsOpen = $state(false)
  let languageMenuOpen = $state(false)
  let isPlaying = $state(false)
  let playbackSupported = $state(true)

  let editorRef = $state<CodeEditorHandle | null>(null)
  let languageButtonRef = $state<HTMLElement | null>(null)
  let languagePanelRef = $state<HTMLDivElement | null>(null)

  let currentSegmentIndex = $state(0)
  let totalSegments = $state(0)
  let synthesizedCount = $state(0)
  let playedDuration = $state(0)
  let currentSegmentLabel = $state('')
  let currentVoiceName = $state('')
  let currentSynthesisRate = $state(1)
  let playbackElapsed = $state(0)
  let playbackDuration = $state(0)
  let showMetadata = $state(false)
  let metadataAvailable = $state(false)
  let metaSearch = $state('')
  let metaSyncing = $state(false)
  let metaStale = $state(false)
  let metaDirty = $state(false)
  let followSentence = $state(true)
  let tableBodyRef = $state<HTMLDivElement | null>(null)

  let isWide = $state(false)
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => (isWide = mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })
  let currentSegmentText = $state('')
  let currentRanges = $state<HighlightRange[]>([])
  let currentBoundaries = $state<TtsBoundary[]>([])
  let segmentMetaMap = $state<Record<number, SegmentMeta>>({})
  let sessionSegments: ReturnType<typeof splitTtsSegments> = []
  let sessionOffset = 0
  let sessionSelectedRange: { from: number; to: number } | null = null

  const synthesisCache = new Map<string, { blob: Blob; boundaries: TtsBoundary[] }>()
  let metaController: { cancelled: boolean } | null = null
  let metaAbort: AbortController | null = null
  let metaSignature = ''
  let metaDebounce: ReturnType<typeof setTimeout> | null = null

  const SEGMENT_LANGUAGE_LABELS: Record<UiLocale, Record<string, string>> = {
    en: { en: 'English', zh: 'Chinese', yue: 'Cantonese', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', ru: 'Russian' },
    'zh-TW': { en: '英文', zh: '中文', yue: '粵語', ja: '日文', ko: '韓文', es: '西班牙文', fr: '法文', ru: '俄文' },
    'zh-CN': { en: '英文', zh: '中文', yue: '粤语', ja: '日文', ko: '韩文', es: '西班牙文', fr: '法文', ru: '俄文' },
  }

  function segmentLabel(lang: string): string {
    return SEGMENT_LANGUAGE_LABELS[locale]?.[lang] ?? lang
  }

  function formatClock(sec: number): string {
    const total = Math.max(0, Math.floor(sec || 0))
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  function trimWhitespaceRange(text: string, start: number, end: number): { start: number; end: number } {
    let s = start
    let e = end
    while (s < e && /\s/.test(text[s] ?? '')) s += 1
    while (e > s && /\s/.test(text[e - 1] ?? '')) e -= 1
    return { start: s, end: e }
  }

  let storageReady = false
  let lastStatusReason = $state<'ready' | 'unavailable' | 'stopped' | 'finished' | 'error'>('ready')
  let currentController: PlaybackController | null = null
  let currentAudio = $state<HTMLAudioElement | null>(null)
  let currentAudioUrl = ''

  const text = $derived(UI_TEXT[locale])
  const totalElapsed = $derived(playedDuration + playbackElapsed)
  const totalDuration = $derived.by(() => {
    let total = 0
    for (const meta of Object.values(segmentMetaMap)) {
      const lastAt = meta.boundaries.length > 0 ? meta.boundaries[meta.boundaries.length - 1].at : 0
      total += meta.duration ?? lastAt
    }
    return total
  })
  const playbackStatus = $derived(
    isPlaying
      ? `${text.playbackRunning} · ${currentSegmentIndex}/${totalSegments} · ${currentSegmentLabel} · ${currentVoiceName} · ${
          totalDuration > 0 ? `${formatClock(totalElapsed)}/${formatClock(totalDuration)}` : formatClock(totalElapsed)
        }`
      : '',
  )
  const canPlay = $derived(content.length > 0 && playbackSupported)

  const metadataRows = $derived.by(() => {
    const rows: Array<{
      segmentIndex: number
      at: number
      offset: number
      lang: string
      text: string
      active: boolean
    }> = []
    const activeSeg = isPlaying ? currentSegmentIndex - 1 : -1
    const activeMeta = activeSeg >= 0 ? segmentMetaMap[activeSeg] : undefined
    let activeBoundaryIndex = -1
    if (activeMeta) {
      const boundaries = activeMeta.boundaries
      for (let i = 0; i < boundaries.length; i += 1) {
        if (boundaries[i].at <= playbackElapsed) activeBoundaryIndex = i
        else break
      }
    }
    let cumulative = 0
    const indices = Object.keys(segmentMetaMap).map(Number).sort((a, b) => a - b)
    for (const i of indices) {
      const meta = segmentMetaMap[i]
      if (!meta) continue
      const lastAt = meta.boundaries.length > 0 ? meta.boundaries[meta.boundaries.length - 1].at : 0
      const segDuration = meta.duration ?? lastAt
      meta.boundaries.forEach((boundary, boundaryIndex) => {
        const range =
          meta.ranges.find(r => boundary.offset >= r.start && boundary.offset < r.end) ?? meta.ranges[meta.ranges.length - 1]
        const text = boundary.text ?? (range ? meta.text.slice(range.start, range.end) : '')
        rows.push({
          segmentIndex: meta.index,
          at: cumulative + boundary.at,
          offset: meta.baseOffset + boundary.offset,
          lang: meta.lang,
          text,
          active: meta.index === activeSeg && boundaryIndex === activeBoundaryIndex,
        })
      })
      cumulative += segDuration
    }
    rows.sort((a, b) => a.segmentIndex - b.segmentIndex || a.at - b.at)
    const query = metaSearch.trim().toLowerCase()
    if (query) {
      return rows.filter(
        row =>
          row.text.toLowerCase().includes(query) ||
          String(row.offset).includes(query) ||
          row.lang.toLowerCase().includes(query),
      )
    }
    return rows
  })

  const activeRowOffset = $derived.by(() => {
    const active = metadataRows.find(row => row.active)
    return active ? active.offset : -1
  })

  function scrollActiveIntoView() {
    if (!followSentence || !tableBodyRef) return
    const container = tableBodyRef
    const el = container.querySelector<HTMLElement>('tr[data-active="true"]')
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const elTop = elRect.top - containerRect.top + container.scrollTop
    const elBottom = elRect.bottom - containerRect.top + container.scrollTop
    const remaining = container.scrollHeight - elBottom
    const headerHeight = container.querySelector('thead')?.offsetHeight ?? 0
    const target = remaining <= container.clientHeight ? container.scrollHeight : Math.max(0, elTop - headerHeight)
    container.scrollTo({ top: target, behavior: 'smooth' })
  }

  $effect(() => {
    const offset = activeRowOffset
    if (offset < 0) {
      return
    }
    scrollActiveIntoView()
  })

  onMount(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as {
            locale?: UiLocale
            content?: string
            speed?: number
            voiceSelections?: Record<string, string>
            groupSelections?: Record<string, string>
            synthesisConcurrency?: number
          }
          locale = parsed.locale ?? locale
          content = parsed.content ?? content
          speed = SPEEDS.includes((parsed.speed ?? 1) as (typeof SPEEDS)[number]) ? (parsed.speed ?? 1) : 1
          voiceSelections = { ...voiceSelections, ...(parsed.voiceSelections ?? {}) }
          groupSelections = { ...groupSelections, ...(parsed.groupSelections ?? {}) }
          synthesisConcurrency = typeof parsed.synthesisConcurrency === 'number' && parsed.synthesisConcurrency >= 1 && parsed.synthesisConcurrency <= 8 ? parsed.synthesisConcurrency : 4
        } catch {
          // Ignore invalid local storage data.
        }
      }
    }

    lastStatusReason = playbackSupported ? 'ready' : 'unavailable'
    statusMessage = playbackSupported ? UI_TEXT[locale].ready : UI_TEXT[locale].browserSpeechUnavailable
    storageReady = true
    return () => {
      if (currentController) {
        stopPlayback()
      }
    }
  })

  $effect(() => {
    if (!storageReady || typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        locale,
        content,
        speed,
        synthesisConcurrency,
        voiceSelections,
        groupSelections,
      }),
    )
  })

  $effect(() => {
    if (isPlaying) {
      return
    }
    if (lastStatusReason === 'unavailable') {
      statusMessage = text.browserSpeechUnavailable
      return
    }
    if (lastStatusReason === 'stopped') {
      statusMessage = text.playbackStopped
      return
    }
    if (lastStatusReason === 'finished') {
      statusMessage = text.playbackFinished
      return
    }
    if (lastStatusReason === 'ready') {
      statusMessage = text.ready
    }
  })

  $effect(() => {
    if (!languageMenuOpen) {
      return
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (languageButtonRef && !languageButtonRef.contains(target) && languagePanelRef && !languagePanelRef.contains(target)) {
        languageMenuOpen = false
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        languageMenuOpen = false
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape, true)
    }
  })

  $effect(() => {
    if (isPlaying && currentAudio) {
      currentAudio.playbackRate = speed / currentSynthesisRate
    }
  })

  $effect(() => {
    if (isPlaying) {
      return
    }
    const signature = currentMetaSignature()
    if (metaSignature && signature !== metaSignature && !metaDirty) {
      metaDirty = true
    }
    if (!metaDirty || !showMetadata) {
      return
    }
    metaDirty = false
    metaSignature = ''
    cancelPendingSynthesis()
    segmentMetaMap = {}
    metadataAvailable = false
    metaStale = true
    metaDebounce = setTimeout(() => {
      metaDebounce = null
      if (!isPlaying) {
        resyncMetadata()
      }
    }, 500)
  })

  function setLocale(nextLocale: UiLocale) {
    locale = nextLocale
    languageMenuOpen = false
    if (!playbackSupported) {
      lastStatusReason = 'unavailable'
      statusMessage = UI_TEXT[nextLocale].browserSpeechUnavailable
      return
    }
    if (lastStatusReason === 'stopped') {
      statusMessage = UI_TEXT[nextLocale].playbackStopped
      return
    }
    if (lastStatusReason === 'finished') {
      statusMessage = UI_TEXT[nextLocale].playbackFinished
      return
    }
    lastStatusReason = 'ready'
    statusMessage = UI_TEXT[nextLocale].ready
  }

  function setGroup(languageCode: string, group: string) {
    groupSelections = { ...groupSelections, [languageCode]: group }
    const nextVoice = voiceForSelection(languageCode, voiceSelections[languageCode], group)
    if (nextVoice) {
      voiceSelections = { ...voiceSelections, [languageCode]: nextVoice.edge }
    }
  }

  function setVoice(languageCode: string, voiceId: string) {
    voiceSelections = { ...voiceSelections, [languageCode]: voiceId }
  }

  function stopPlayback() {
    currentController = currentController ? { ...currentController, cancelled: true } : null
    isPlaying = false
    currentAudio?.pause()
    currentAudio = null
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl)
      currentAudioUrl = ''
    }
    synthesizedCount = 0
    lastStatusReason = 'stopped'
    statusMessage = text.playbackStopped
    metadataAvailable = false
  }

  function resolveVoiceForSegment(segmentLang: string) {
    const languageCode = segmentLang === 'yue' ? 'zh' : segmentLang
    const group = segmentLang === 'yue' ? 'Cantonese' : groupSelections[languageCode] ?? ''
    return voiceForSelection(languageCode, voiceSelections[languageCode], group)
  }


  async function synthesizeSegment(textToSpeak: string, voiceId: string, rate: number, signal?: AbortSignal) {
    const response = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textToSpeak, voice: voiceId, rate }),
      signal,
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(typeof data.error === 'string' ? data.error : 'Synthesis failed.')
    }

    const data = (await response.json()) as { audio: string; boundaries: TtsBoundary[] }
    const binary = atob(data.audio)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return { blob: new Blob([bytes], { type: 'audio/mpeg' }), boundaries: data.boundaries }
  }

  async function getCachedSynthesis(
    textToSpeak: string,
    voiceId: string,
    rate: number,
    signal?: AbortSignal,
  ) {
    const cacheKey = synthesisCacheKey(textToSpeak, voiceId, rate)
    const cached = synthesisCache.get(cacheKey)
    if (cached) return cached
    const synth = await synthesizeSegment(textToSpeak, voiceId, rate, signal)
    const entry = { blob: synth.blob, boundaries: synth.boundaries }
    synthesisCache.set(cacheKey, entry)
    return entry
  }

  function playAudioBlob(
    controller: PlaybackController,
    blob: Blob,
    onProgress?: (currentTime: number) => void,
    startAt = 0,
  ) {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio()
      const url = URL.createObjectURL(blob)
      currentAudio?.pause()
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl)
      }
      currentAudioUrl = url
      currentAudio = audio
      audio.src = url

      let rafId = 0
      const stopTick = () => {
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
      }
      const tick = () => {
        if (controller.cancelled || rafId === 0) return
        if (audio.paused || audio.ended) {
          stopTick()
          return
        }
        playbackElapsed = audio.currentTime
        onProgress?.(audio.currentTime)
        rafId = requestAnimationFrame(tick)
      }
      const startTick = () => {
        if (!rafId) rafId = requestAnimationFrame(tick)
      }

      audio.onloadedmetadata = () => {
        playbackDuration = Number.isFinite(audio.duration) ? audio.duration : 0
        if (startAt > 0 && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.min(startAt, audio.duration)
        }
      }
      audio.ontimeupdate = () => {
        // Coarse fallback when requestAnimationFrame is paused (e.g. hidden tab).
        playbackElapsed = audio.currentTime
        onProgress?.(audio.currentTime)
      }
      audio.onended = () => {
        stopTick()
        if (currentAudioUrl === url) {
          URL.revokeObjectURL(url)
          currentAudioUrl = ''
          currentAudio = null
        }
        resolve()
      }
      audio.onerror = () => {
        stopTick()
        if (currentAudioUrl === url) {
          URL.revokeObjectURL(url)
          currentAudioUrl = ''
          currentAudio = null
        }
        if (controller.cancelled) {
          resolve()
          return
        }
        reject(new Error('Audio playback failed.'))
      }

      audio.play().then(startTick).catch(error => {
        stopTick()
        if (currentAudioUrl === url) {
          URL.revokeObjectURL(url)
          currentAudioUrl = ''
          currentAudio = null
        }
        reject(error)
      })
    })
  }
  async function startPlayback() {
    if (!canPlay || !editorRef || isPlaying) {
      return
    }

    const selectedRange = editorRef.getSelectionRange()
    const playbackText = selectedRange ? content.slice(selectedRange.from, selectedRange.to) : content
    const playbackOffset = selectedRange?.from ?? 0
    const segments = splitTtsSegments(playbackText)
    if (segments.length === 0) {
      return
    }

    sessionSegments = segments
    sessionOffset = playbackOffset
    sessionSelectedRange = selectedRange
    segmentMetaMap = {}
    metaSignature = `${content}|${selectedRange?.from ?? -1}-${selectedRange?.to ?? -1}`
    metaSearch = ''
    metaStale = false
    metaDirty = false
    await runPlayback(segments, playbackOffset, 0)
  }

  async function playFromSegment(index: number, charOffset?: number) {
    if (sessionSegments.length === 0) {
      return
    }
    stopPlayback()
    let startAt = 0
    if (charOffset != null) {
      const meta = segmentMetaMap[index]
      const boundary = meta?.boundaries.find(b => meta.baseOffset + b.offset === charOffset)
      if (boundary) {
        startAt = boundary.at
      }
    }
    await runPlayback(sessionSegments, sessionOffset, index, startAt)
  }

  async function runPlayback(
    segments: ReturnType<typeof splitTtsSegments>,
    playbackOffset: number,
    startIndex: number,
    startAt = 0,
  ) {
    const controller: PlaybackController = { cancelled: false }
    currentController = controller
    isPlaying = true
    lastStatusReason = 'ready'

    try {
      const concurrency = synthesisConcurrency
      synthesizedCount = Object.keys(segmentMetaMap).length
      playedDuration = 0
      for (let i = 0; i < startIndex; i += 1) {
        const prior = segmentMetaMap[i]
        playedDuration += prior?.duration ?? (prior?.boundaries.length ? prior.boundaries[prior.boundaries.length - 1].at : 0)
      }
      const tasks = new Map<number, Promise<LaunchedSegment>>()
      let active = 0
      const waiters: Array<() => void> = []
      const acquire = () =>
        new Promise<void>(resolve => {
          if (active < concurrency) {
            active += 1
            resolve()
          } else {
            waiters.push(resolve)
          }
        })
      let nextToLaunch = 0
      const scheduleNext = () => {
        if (controller.cancelled) return
        while (nextToLaunch < segments.length && active < concurrency) {
          launch(nextToLaunch++)
        }
      }
      const release = () => {
        active -= 1
        const next = waiters.shift()
        if (next) {
          active += 1
          next()
        }
        scheduleNext()
      }
      const launch = (index: number) => {
        const existing = tasks.get(index)
        if (existing) return existing
        const segment = segments[index]
        const voice = resolveVoiceForSegment(segment.lang)
        const rate = speed
        const task = (async () => {
          await acquire()
          try {
            if (!voice?.edge) {
              throw new Error(`No voice configured for segment language '${segment.lang}'.`)
            }
            const synth = await getCachedSynthesis(segment.text, voice.edge, rate)
            return { blob: synth.blob, boundaries: synth.boundaries, rate, voiceName: voice.name }
          } finally {
            release()
          }
        })()
        task.then((res) => {
          if (controller.cancelled) {
            return
          }
          segmentMetaMap[index] = {
            index,
            lang: segment.lang,
            text: segment.text,
            ranges: splitHighlightRanges(segment.text),
            boundaries: res.boundaries,
            baseOffset: playbackOffset + segment.indexStart,
          }
          synthesizedCount = Object.keys(segmentMetaMap).length
        })
        tasks.set(index, task)
        return task
      }

      scheduleNext()
      for (let index = startIndex; index < segments.length; index += 1) {
        const segment = segments[index]
        if (controller.cancelled) {
          return
        }
        currentSegmentIndex = index + 1
        totalSegments = segments.length
        currentSegmentLabel = segmentLabel(segment.lang)
        playbackElapsed = 0
        playbackDuration = 0
        const ranges = splitHighlightRanges(segment.text)
        const absoluteBase = playbackOffset + segment.indexStart
        const result = await launch(index)
        if (controller.cancelled) {
          return
        }
        currentVoiceName = result.voiceName
        currentSynthesisRate = result.rate
        currentSegmentText = segment.text
        currentRanges = ranges
        currentBoundaries = result.boundaries
        metadataAvailable = result.boundaries.length > 0

        const applyHighlight = (currentTime: number) => {
          const range = activeHighlightRange(ranges, result.boundaries, currentTime)
          if (range) {
            const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
            editorRef?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
          }
        }

        const selectWholeSegment = () => {
          const trimmed = trimWhitespaceRange(segment.text, 0, segment.text.length)
          editorRef?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
        }

        const segAt = index === startIndex ? startAt : 0
        if (segAt > 0 && ranges.length > 0 && result.boundaries.length > 0) {
          const range = activeHighlightRange(ranges, result.boundaries, segAt)
          if (range) {
            const trimmed = trimWhitespaceRange(segment.text, range.start, range.end)
            editorRef?.setSelection(absoluteBase + trimmed.start, absoluteBase + trimmed.end)
          } else {
            selectWholeSegment()
          }
        } else if (ranges.length === 0 || result.boundaries.length === 0) {
          selectWholeSegment()
        } else {
          applyHighlight(0)
        }

        await playAudioBlob(
          controller,
          result.blob,
          ranges.length > 0 && result.boundaries.length > 0 ? applyHighlight : undefined,
          segAt,
        )
        playedDuration += playbackDuration
        const recorded = segmentMetaMap[index]
        if (recorded) {
          recorded.duration = playbackDuration
        }
      }

      if (controller.cancelled) {
        return
      }
      currentController = null
      isPlaying = false
      lastStatusReason = 'finished'
      metadataAvailable = false
      synthesizedCount = totalSegments
      if (sessionSelectedRange) {
        editorRef?.setSelection(sessionSelectedRange.from, sessionSelectedRange.to)
      } else {
        editorRef?.clearSelection()
      }
      statusMessage = text.playbackFinished
    } catch (error) {
      if (controller.cancelled) {
        return
      }
      currentController = null
      isPlaying = false
      lastStatusReason = 'error'
      metadataAvailable = false
      statusMessage = error instanceof Error ? error.message : 'Playback failed.'
    }
  }

  function currentMetaSignature(): string {
    const sel = editorRef?.getSelectionRange() ?? null
    return `${content}|${sel?.from ?? -1}-${sel?.to ?? -1}`
  }

  function cancelPendingSynthesis() {
    if (metaController) {
      metaController.cancelled = true
    }
    metaAbort?.abort()
    metaAbort = null
    if (metaDebounce) {
      clearTimeout(metaDebounce)
      metaDebounce = null
    }
  }

  async function resyncMetadata() {
    cancelPendingSynthesis()
    const controller: { cancelled: boolean } = { cancelled: false }
    metaController = controller
    const selectedRange = editorRef?.getSelectionRange() ?? null
    const playbackText = selectedRange ? content.slice(selectedRange.from, selectedRange.to) : content
    const playbackOffset = selectedRange?.from ?? 0
    const signature = currentMetaSignature()
    const segments = splitTtsSegments(playbackText)

    segmentMetaMap = {}
    metaStale = false
    if (segments.length === 0) {
      metaSignature = signature
      metaController = null
      return
    }

    metaSyncing = true
    try {
      for (let index = 0; index < segments.length; index += 1) {
        if (controller.cancelled) {
          return
        }
        const segment = segments[index]
        const voice = resolveVoiceForSegment(segment.lang)
        if (!voice?.edge) {
          continue
        }
        metaAbort = new AbortController()
        const entry = await getCachedSynthesis(segment.text, voice.edge, speed, metaAbort.signal)
        metaAbort = null
        if (controller.cancelled) {
          return
        }
        segmentMetaMap[index] = {
          index,
          lang: segment.lang,
          text: segment.text,
          ranges: splitHighlightRanges(segment.text),
          boundaries: entry.boundaries,
          baseOffset: playbackOffset + segment.indexStart,
        }
      }
      if (controller.cancelled) {
        return
      }
      metaSignature = signature
      metaDirty = false
      metaStale = false
      metadataAvailable = Object.keys(segmentMetaMap).length > 0
    } catch (error) {
      if (!controller.cancelled) {
        metadataAvailable = false
        statusMessage = error instanceof Error ? error.message : 'Playback failed.'
      }
    } finally {
      if (metaController === controller) {
        metaController = null
        metaSyncing = false
      }
    }
  }
</script>

<svelte:head>
  <title>TTS</title>
</svelte:head>

<div class="flex h-dvh min-h-screen flex-col bg-slate-950 text-slate-100">
  <header class="flex items-center justify-between gap-4 border-b border-slate-800 px-3 py-3 sm:px-4">
    <h1 class="text-base font-semibold tracking-tight sm:text-lg">TTS</h1>
    <div class="flex items-center gap-2">
      <span bind:this={languageButtonRef} class="inline-flex">
        <Button
          variant="secondary"
          size="sm"
          ariaLabel={text.language}
          ariaExpanded={languageMenuOpen}
          tooltip={text.language}
          onClick={() => (languageMenuOpen = !languageMenuOpen)}>
          {#snippet icon()}
            <GlobeIcon className="h-4 w-4" />
          {/snippet}
        </Button>
      </span>
      <Button variant="secondary" size="sm" ariaLabel={text.settings} tooltip={text.settings} onClick={() => (settingsOpen = true)}>
        {#snippet icon()}
          <SettingsIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </div>
  </header>

  <main class="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4">
    <section aria-label="Playback controls" class="flex flex-wrap items-center gap-1.5">
      <Button
        variant="outline"
        accent="cyan"
        size="sm"
        ariaPressed={isPlaying}
        disabled={isPlaying ? false : !canPlay}
        ariaLabel={isPlaying ? text.stop : text.playback}
        tooltip={isPlaying ? text.stop : text.playback}
        onClick={isPlaying ? stopPlayback : startPlayback}
        className="px-2.5 py-1.5 text-sm">
        {#snippet icon()}
          {#if isPlaying}
            <StopIcon className="h-4 w-4" />
          {:else}
            <SpeakerIcon className="h-4 w-4" />
          {/if}
        {/snippet}
        {isPlaying ? text.stop : text.playback}
      </Button>

      <Button
        variant="secondary"
        size="sm"
        ariaPressed={showMetadata}
        ariaLabel={text.info}
        tooltip={text.info}
        onClick={() => (showMetadata = !showMetadata)}>
        {#snippet icon()}
          <InfoIcon className="h-4 w-4" />
        {/snippet}
      </Button>
    </section>

    <div class="mt-3 flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex-none text-sm text-slate-400" aria-live="polite">{isPlaying ? playbackStatus : statusMessage}</div>
      {#if isPlaying}
        <div class="flex-none">
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={totalSegments} aria-valuenow={synthesizedCount}>
            <div
              class="h-full rounded-full bg-cyan-500 transition-[width] duration-200 motion-reduce:transition-none"
              style={`width: ${totalSegments > 0 ? (synthesizedCount / totalSegments) * 100 : 0}%`}></div>
          </div>
          <div class="mt-1 text-xs text-slate-400">{text.synthesized} {synthesizedCount}/{totalSegments}</div>
        </div>
      {/if}
      <div class="flex min-h-0 flex-1 gap-2 {showMetadata ? (isWide ? 'flex-row' : 'flex-col') : 'flex-col'}">
        <div
          class="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-slate-950/30">
          <CodeEditor
            bind:this={editorRef}
            bind:content
            editable={!isPlaying}
            autoFocus={true}
            editorAriaLabel="TTS editor"
            containerClass="min-h-0 flex-1"
            editorClass="h-full" />
        </div>

        {#if showMetadata}
          <section aria-label={text.info} class="flex min-h-0 min-w-0 {isWide ? 'w-[32%] min-w-[18rem]' : 'flex-1'} flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div class="flex min-h-0 w-full flex-1 flex-col gap-2">
              <div class="flex flex-none items-center gap-2">
                <label class="relative block flex-1">
                  <span class="sr-only">{text.metadataSearch}</span>
                  <input
                    type="search"
                    bind:value={metaSearch}
                    placeholder={text.metadataSearch}
                    aria-label={text.metadataSearch}
                    class="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50" />
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  ariaPressed={followSentence}
                  ariaLabel={text.followSentence}
                  tooltip={text.followSentence}
                  onClick={() => (followSentence = !followSentence)}
                  className={followSentence ? 'border border-cyan-500/50 bg-cyan-500/10 text-cyan-200' : 'border border-slate-700 text-slate-400 hover:text-slate-200'}>
                  {#snippet icon()}
                    <FollowIcon className="h-4 w-4" />
                  {/snippet}
                </Button>
              </div>
              <div class="flex flex-none flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{text.synthesized} {synthesizedCount}/{totalSegments}</span>
                <span aria-hidden="true">·</span>
                {#if metaSyncing}
                  <span>{text.metadataRefreshing}</span>
                {:else if metaStale}
                  <span>{text.metadataStale}</span>
                {:else}
                  <span>{text.segmentHint}</span>
                {/if}
              </div>
              {#if metadataRows.length === 0}
                <p class="text-xs text-slate-500">{metaSearch.trim() ? text.metadataNoResults : text.noMetadata}</p>
              {:else}
                <div bind:this={tableBodyRef} class="min-h-0 flex-1 overflow-auto">
                  <table class="w-full border-collapse text-sm">
                    <thead class="sticky top-0 z-10 bg-slate-950">
                      <tr class="text-left text-xs text-slate-400">
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableSeg}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableTime}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableOffset}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableLang}</th>
                        <th scope="col" class="px-2 py-1 font-medium">{text.tableText}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each metadataRows as row}
                        <tr
                          data-active={row.active}
                          role="button"
                          tabindex="0"
                          aria-label={`${text.playSegment} ${row.segmentIndex + 1}`}
                          onclick={() => playFromSegment(row.segmentIndex, row.offset)}
                          onkeydown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              playFromSegment(row.segmentIndex)
                            }
                          }}
                          class="cursor-pointer border-t border-slate-800 align-top {row.active ? 'bg-cyan-500/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/60'}">
                          <td class="px-2 py-1 font-mono whitespace-nowrap">{row.segmentIndex + 1}</td>
                          <td class="px-2 py-1 font-mono whitespace-nowrap">{row.at.toFixed(2)}s</td>
                          <td class="px-2 py-1 font-mono whitespace-nowrap">{row.offset}</td>
                          <td class="px-2 py-1 whitespace-nowrap">{row.lang}</td>
                          <td class="px-2 py-1">{row.text}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          </section>
        {/if}
      </div>
    </div>
  </main>

  {#if languageMenuOpen}
    <div
      bind:this={languagePanelRef}
      role="menu"
      aria-label={text.languageMenuLabel}
      use:positionPanel={() => ({ getTrigger: () => languageButtonRef, getOpen: () => languageMenuOpen, align: 'right', autoPlace: true })}
      class="fixed left-0 top-0 z-50 w-52 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur">
      {#each UI_LANGUAGE_OPTIONS as option}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={locale === option.value}
          onclick={() => setLocale(option.value)}
          class={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm outline-none transition motion-reduce:transition-none ${locale === option.value ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200 focus:bg-slate-800 focus:text-cyan-200'}`}>
          {option.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if settingsOpen}
    <SettingsDialog
      {locale}
      {speed}
      {synthesisConcurrency}
      {voiceSelections}
      {groupSelections}
      onCancel={() => (settingsOpen = false)}
      onSelectVoice={setVoice}
      onSelectGroup={setGroup}
      onSelectSpeed={nextSpeed => (speed = nextSpeed)}
      onSelectConcurrent={next => (synthesisConcurrency = next)} />
  {/if}
</div>
