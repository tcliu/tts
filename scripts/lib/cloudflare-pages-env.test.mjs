import { describe, expect, it } from 'vitest'

import {
  diffDesiredSecrets,
  diffDesiredVars,
  fetchPagesEnvState,
  findOrphanKeys,
  patchPagesEnvVars,
} from './cloudflare-pages-env.mjs'

const PLAIN = type => ({ type: 'plain_text', value: type })
const SECRET = { type: 'secret_text', value: '' }

describe('diffDesiredVars', () => {
  it('splits desired vars into missing, changed, and unchanged', () => {
    const diff = diffDesiredVars(
      { MISSING: 'a', CHANGED: 'b', SAME: 'c', RETYPED: 'd' },
      { CHANGED: PLAIN('old'), SAME: PLAIN('c'), RETYPED: SECRET },
    )
    expect(diff.missing).toEqual(['MISSING'])
    expect(diff.changed).toEqual(['CHANGED', 'RETYPED'])
    expect(diff.unchanged).toEqual(['SAME'])
    expect(diff.drift).toEqual(['MISSING', 'CHANGED', 'RETYPED'])
  })

  it('treats a remote plain var with the same value as unchanged', () => {
    expect(diffDesiredVars({ A: '1' }, { A: PLAIN('1') }).drift).toEqual([])
  })

  it('reports nothing when there is nothing desired', () => {
    expect(diffDesiredVars({}, { A: PLAIN('1') })).toEqual({
      missing: [],
      changed: [],
      unchanged: [],
      drift: [],
    })
  })
})

describe('diffDesiredSecrets', () => {
  it('compares by name only (values are write-only)', () => {
    expect(diffDesiredSecrets({ A: 'x', B: 'y' }, { A: SECRET })).toEqual({
      missing: ['B'],
      present: ['A'],
    })
  })
})

describe('findOrphanKeys', () => {
  it('lists remote keys absent from the desired universe', () => {
    expect(findOrphanKeys({ KEEP: PLAIN('1'), STALE: PLAIN('2'), OLD_SECRET: SECRET }, ['KEEP'])).toEqual([
      'STALE',
      'OLD_SECRET',
    ])
  })
})

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return { ok, status, json: async () => payload }
  }
  return { calls, fetchImpl }
}

describe('fetchPagesEnvState', () => {
  it('reads the production env_vars and config hash', async () => {
    const { calls, fetchImpl } = stubFetch({
      success: true,
      result: {
        deployment_configs: {
          production: { env_vars: { A: PLAIN('1') }, wrangler_config_hash: 'h1' },
        },
      },
    })
    const state = await fetchPagesEnvState({ project: 'tts', accountId: 'acct', token: 'tok', fetchImpl })
    expect(state).toEqual({ envVars: { A: PLAIN('1') }, configHash: 'h1' })
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/pages/projects/tts')
  })

  it('returns an empty state for a project with no env vars', async () => {
    const { fetchImpl } = stubFetch({ success: true, result: { deployment_configs: {} } })
    expect(await fetchPagesEnvState({ project: 'p', accountId: 'a', token: 't', fetchImpl })).toEqual({
      envVars: {},
      configHash: undefined,
    })
  })

  it('throws the API detail on failure', async () => {
    const { fetchImpl } = stubFetch(
      { success: false, errors: [{ message: 'no such project' }] },
      { ok: false, status: 404 },
    )
    await expect(
      fetchPagesEnvState({ project: 'p', accountId: 'a', token: 't', fetchImpl }),
    ).rejects.toThrow('Cloudflare API 404: no such project')
  })

  it('throws before fetching without a token or account id', async () => {
    await expect(fetchPagesEnvState({ project: 'p', accountId: 'a', token: '' })).rejects.toThrow(
      'CLOUDFLARE_API_TOKEN is empty',
    )
    await expect(fetchPagesEnvState({ project: 'p', accountId: '', token: 't' })).rejects.toThrow(
      'CLOUDFLARE_ACCOUNT_ID is empty',
    )
  })
})

describe('patchPagesEnvVars', () => {
  it('merge-patches with null deletes and the current config hash', async () => {
    const { calls, fetchImpl } = stubFetch({ success: true, result: {} })
    await patchPagesEnvVars({
      project: 'tts',
      envVars: { A: null, B: PLAIN('2') },
      configHash: 'h1',
      accountId: 'acct',
      token: 'tok',
      fetchImpl,
    })
    expect(calls[0].options.method).toBe('PATCH')
    expect(JSON.parse(calls[0].options.body)).toEqual({
      deployment_configs: {
        production: { env_vars: { A: null, B: PLAIN('2') }, wrangler_config_hash: 'h1' },
      },
    })
  })

  it('omits the config hash when the remote read did not provide one', async () => {
    const { calls, fetchImpl } = stubFetch({ success: true, result: {} })
    await patchPagesEnvVars({ project: 'p', envVars: { A: null }, accountId: 'a', token: 't', fetchImpl })
    expect(JSON.parse(calls[0].options.body).deployment_configs.production).not.toHaveProperty(
      'wrangler_config_hash',
    )
  })

  it('does nothing for an empty patch', async () => {
    const { calls, fetchImpl } = stubFetch({ success: true, result: {} })
    await patchPagesEnvVars({ project: 'p', envVars: {}, accountId: 'a', token: 't', fetchImpl })
    expect(calls).toEqual([])
  })
})
