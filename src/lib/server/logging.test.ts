import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestEvent } from '@sveltejs/kit'
import { logAccess, logEvent } from './logging'

function fakeEvent(overrides: { request: Request; getClientAddress: () => string }): RequestEvent {
  return overrides as unknown as RequestEvent
}

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'log').mockImplementation(line => {
    logged.push(String(line))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logEvent', () => {
  it('emits an ISO-timestamped INFO line with serialized details', () => {
    logEvent({ ip: '127.0.0.1', action: 'tts_synthesize_complete', details: { key: 'abc', elapsed_ms: 12 } })
    expect(logged).toEqual([
      expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO ip=127\.0\.0\.1 action=tts_synthesize_complete key="abc" elapsed_ms=12$/,
      ),
    ])
  })

  it('defaults _error actions to ERROR, honors valid overrides, rejects invalid ones', () => {
    logEvent({ ip: '10.0.0.1', action: 'tts_synthesize_error', details: { error: 'boom' } })
    logEvent({ ip: '10.0.0.1', action: 'tts_synthesize_rate_limited', details: { level: 'WARN' } })
    logEvent({ ip: '10.0.0.1', action: 'tts_synthesize_start', details: { level: 'warn' } })
    expect(logged[0]).toMatch(/ ERROR ip=10\.0\.0\.1 action=tts_synthesize_error error="boom"$/)
    expect(logged[1]).toMatch(/ WARN ip=10\.0\.0\.1 action=tts_synthesize_rate_limited$/)
    expect(logged[2]).toMatch(/ INFO ip=10\.0\.0\.1 action=tts_synthesize_start$/)
  })

  it('omits the details portion when empty and falls back to unknown ip', () => {
    logEvent({ ip: '', action: 'tts_synthesize_start' })
    expect(logged).toEqual([expect.stringMatching(/INFO ip=unknown action=tts_synthesize_start$/)])
  })
})

describe('logAccess', () => {
  it('derives the client ip from the request event', () => {
    const event = fakeEvent({
      request: new Request('https://example.test/api/tts/synthesize'),
      getClientAddress: () => '203.0.113.7',
    })
    logAccess({ event, action: 'tts_synthesize_cache_hit' })
    expect(logged).toEqual([expect.stringMatching(/ip=203\.0\.113\.7 action=tts_synthesize_cache_hit$/)])
  })

  it('falls back to x-forwarded-for and logs the resolution failure', () => {
    const prevVercel = process.env.VERCEL
    process.env.VERCEL = '1'
    const event = fakeEvent({
      request: new Request('https://example.test/api/tts/synthesize', {
        headers: { 'x-forwarded-for': '198.51.100.4, 70.41.3.18' },
      }),
      getClientAddress: () => {
        throw new Error('unavailable')
      },
    })
    try {
      logAccess({ event, action: 'tts_synthesize_start', details: { text_length: 5 } })
      expect(logged).toHaveLength(2)
      expect(logged[0]).toMatch(
        /ERROR ip=198\.51\.100\.4 action=client_ip_resolve_error error="unavailable" source="x-forwarded-for"$/,
      )
      expect(logged[1]).toMatch(/ip=198\.51\.100\.4 action=tts_synthesize_start text_length=5$/)
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
    }
  })

  it('resolves to unknown when the client address fails without a forwarded header', () => {
    const event = fakeEvent({
      request: new Request('https://example.test/api/tts/synthesize'),
      getClientAddress: () => {
        throw new Error('unavailable')
      },
    })
    logAccess({ event, action: 'tts_synthesize_start' })
    expect(logged).toHaveLength(2)
    expect(logged[0]).toMatch(
      /ERROR ip=unknown action=client_ip_resolve_error error="unavailable" source="none"$/,
    )
    expect(logged[1]).toMatch(/INFO ip=unknown action=tts_synthesize_start$/)
  })
})
