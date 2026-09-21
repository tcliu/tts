import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadTargetEnv, loadTargetFileEnv, targetOverlayFile, targetSourceFiles } from './target-env.mjs'

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'target-env-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

describe('loadTargetEnv', () => {
  it('overlays .env.prod with the target file, shell wins', () => {
    const dir = fixture({
      '.env.prod': 'SHARED=prod\nSHARED_ONLY=prod\n',
      '.env.cloudflare': 'SHARED=cf\nCF_ONLY=cf\n',
      '.env.vercel': 'SHARED=vercel\n',
    })
    const cf = loadTargetEnv('cloudflare', dir)
    expect(cf.SHARED).toBe('cf')
    expect(cf.CF_ONLY).toBe('cf')
    expect(cf.SHARED_ONLY).toBe('prod')
    const vercel = loadTargetEnv('vercel', dir)
    expect(vercel.SHARED).toBe('vercel')
    expect(vercel.CF_ONLY).toBeUndefined()
  })

  it('includes .env.local (operator tokens) below shell', () => {
    const dir = fixture({
      '.env.prod': 'SHARED=prod\n',
      '.env.local': 'SHARED=local\nLOCAL_TOKEN=t\n',
      '.env.cloudflare': 'SHARED=cf\n',
    })
    expect(loadTargetEnv('cloudflare', dir).SHARED).toBe('cf')
    expect(loadTargetEnv('cloudflare', dir).LOCAL_TOKEN).toBe('t')
  })

  it('sync universe is .env.prod + overlay only (never .env/.env.local/shell)', () => {
    const dir = fixture({
      '.env': 'DEV_ONLY=1\nSHARED=dev\n',
      '.env.local': 'LOCAL_TOKEN=t\nSHARED=local\n',
      '.env.prod': 'SHARED=prod\nPROD_ONLY=p\n',
      '.env.cloudflare': 'SHARED=cf\n',
    })
    const files = loadTargetFileEnv('cloudflare', dir)
    expect(files).toEqual({ SHARED: 'cf', PROD_ONLY: 'p' })
  })

  it('falls back to the vercel overlay for unknown targets', () => {
    expect(targetOverlayFile('nope')).toBe('.env.vercel')
    expect(targetSourceFiles('nope')).toEqual(['.env.prod', '.env.vercel'])
  })

  it('names the per-target overlays', () => {
    expect(targetOverlayFile('vercel')).toBe('.env.vercel')
    expect(targetOverlayFile('cloudflare')).toBe('.env.cloudflare')
    expect(targetSourceFiles('cloudflare')).toEqual(['.env.prod', '.env.cloudflare'])
  })
})
