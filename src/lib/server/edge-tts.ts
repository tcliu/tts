import { createHash, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { RawData } from 'ws'
import { parseEdgeMetadata, type TtsBoundary } from '$lib/tts-reference'
import { getEdgeTtsTimeoutMs } from './admin-properties'

const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_CHROMIUM = '143.0.3650.75'
const WINDOWS_FILE_TIME_EPOCH = 11644473600n
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 30_000

function synthesisTimeoutMs(): number {
  try {
    return getEdgeTtsTimeoutMs()
  } catch {
    return DEFAULT_SYNTHESIS_TIMEOUT_MS
  }
}
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'

function edgeSecMsGecToken() {
  const ticks = BigInt(Math.floor(Date.now() / 1000 + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n
  const roundedTicks = ticks - (ticks % 3000000000n)
  return createHash('sha256').update(`${roundedTicks}${EDGE_TOKEN}`, 'ascii').digest('hex').toUpperCase()
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

import { normalizeForChineseVoice } from './zh-variant'
export { ZH_VARIANT_PAIRS, normalizeForChineseVoice } from './zh-variant'

const EDGE_VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-.+Neural$/

export async function synthesizeEdgeTts(
  text: string,
  edgeVoice: string,
  rate = 1,
): Promise<{ audio: Uint8Array; boundaries: TtsBoundary[]; wordBoundaries: TtsBoundary[]; spokenStart?: number; spokenEnd?: number }> {
  if (!EDGE_VOICE_RE.test(edgeVoice)) throw new Error('Unknown voice')
  const ratePercent = `${Math.round((rate - 1) * 100)}%`
  // zh voice lexicons lack Japanese-exclusive kanji variants; synthesize the
  // normalized text so nothing is skipped. The transform never changes length,
  // so indexes into spokenText are also indexes into text.
  const spokenText = edgeVoice.startsWith('zh') ? normalizeForChineseVoice(text) : text
  const url =
    'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
    `?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${edgeSecMsGecToken()}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM}` +
    `&ConnectionId=${randomUUID().replaceAll('-', '')}`

  const ws = new WebSocket(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    },
  })

  return new Promise<{
    audio: Uint8Array
    boundaries: TtsBoundary[]
    wordBoundaries: TtsBoundary[]
    spokenStart?: number
    spokenEnd?: number
  }>((resolve, reject) => {
    const audioChunks: Uint8Array[] = []
    const boundaries: TtsBoundary[] = []
    const wordBoundaries: TtsBoundary[] = []
    let wordCursor = 0
    let sentenceCursor = 0
    let wordSpanStart: number | undefined
    let wordSpanEnd: number | undefined
    let closed = false

    const timeout = setTimeout(() => {
      if (closed) return
      closed = true
      ws.terminate()
      reject(new Error('Edge TTS synthesis timed out'))
    }, synthesisTimeoutMs())

    const settle = (fn: () => void) => {
      clearTimeout(timeout)
      fn()
    }

    ws.on('open', () => {
      const config = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: true, wordBoundaryEnabled: true },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            },
          },
        },
      })

      ws.send(
        `X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}`,
      )

      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${escapeXml(edgeVoice)}'><prosody pitch='+0Hz' rate='${ratePercent}' volume='+0%'>` +
        `${escapeXml(spokenText)}</prosody></voice></speak>`

      ws.send(
        `X-RequestId:${randomUUID().replaceAll('-', '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n${ssml}`,
      )
    })

    ws.on('message', (data: RawData) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      const str = buffer.toString('utf-8')

      if (str.includes('audio.metadata')) {
        for (const event of parseEdgeMetadata(str)) {
          if (event.type === 'WordBoundary') {
            const at = event.offset * 1e-7
            const dur = (event.duration ?? 0) * 1e-7
            if (wordSpanStart == null || at < wordSpanStart) wordSpanStart = at
            if (wordSpanEnd == null || at + dur > wordSpanEnd) wordSpanEnd = at + dur
            if (event.text) {
              let index = spokenText.indexOf(event.text, wordCursor)
              if (index < 0) index = spokenText.indexOf(event.text)
              if (index >= 0) {
                wordCursor = index + event.text.length
                wordBoundaries.push({
                  offset: index,
                  at,
                  duration: event.duration != null ? event.duration * 1e-7 : undefined,
                  text: text.slice(index, index + event.text.length),
                })
              }
            }
            continue
          }
          if (event.type !== 'SentenceBoundary') continue
          if (!event.text) continue
          let index = spokenText.indexOf(event.text, sentenceCursor)
          if (index < 0) index = spokenText.indexOf(event.text)
          if (index < 0) continue
          sentenceCursor = index + event.text.length
          boundaries.push({
            offset: index,
            at: event.offset * 1e-7,
            duration: event.duration != null ? event.duration * 1e-7 : undefined,
            text: text.slice(index, index + event.text.length),
          })
        }
        return
      }

      if (buffer.includes(Buffer.from('Path:audio\r\n'))) {
        const separator = Buffer.from('Path:audio\r\n')
        const index = buffer.indexOf(separator)
        if (index >= 0) {
          audioChunks.push(buffer.subarray(index + separator.length))
        }
        return
      }

      if (str.includes('turn.end')) {
        closed = true
        ws.close()
        const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const output = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of audioChunks) {
          output.set(chunk, offset)
          offset += chunk.length
        }
        boundaries.sort((a, b) => a.at - b.at)
        wordBoundaries.sort((a, b) => a.at - b.at)
        const spokenStart = wordSpanStart ?? boundaries[0]?.at
        const lastBoundary = boundaries.length > 0 ? boundaries[boundaries.length - 1] : undefined
        const spokenEnd = wordSpanEnd ?? (lastBoundary ? (lastBoundary.at ?? 0) + (lastBoundary.duration ?? 0) : undefined)
        settle(() => resolve({ audio: output, boundaries, wordBoundaries, spokenStart, spokenEnd }))
      }
    })

    ws.on('error', (error: Error) => {
      if (!closed) {
        closed = true
        settle(() => reject(new Error(error.message || 'Edge WebSocket error')))
      }
    })

    // Any close that did not go through turn.end is abnormal for this flow;
    // reject so callers never wait on a pending promise.
    ws.on('close', (code: number) => {
      if (!closed) {
        closed = true
        settle(() => reject(new Error(`Edge WebSocket closed unexpectedly (code ${code})`)))
      }
    })
  })
}
