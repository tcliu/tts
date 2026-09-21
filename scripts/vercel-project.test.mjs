// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  decideLinkAction,
  defaultProjectName,
  isValidProjectName,
  normalizeProjectName,
  resolveProjectName,
  upsertEnvLine,
} from './vercel-project.mjs'

describe('isValidProjectName', () => {
  it('accepts lowercase letters, numbers, and interior hyphens', () => {
    expect(isValidProjectName('ui-lib')).toBe(true)
    expect(isValidProjectName('codepg-tts')).toBe(true)
    expect(isValidProjectName('a')).toBe(true)
  })

  it('rejects blanks, edges, and illegal characters', () => {
    expect(isValidProjectName('')).toBe(false)
    expect(isValidProjectName('-ui-lib')).toBe(false)
    expect(isValidProjectName('ui-lib-')).toBe(false)
    expect(isValidProjectName('ui lib')).toBe(false)
    expect(isValidProjectName('ui_lib')).toBe(false)
    expect(isValidProjectName('UI-LIB')).toBe(false)
  })
})

describe('normalizeProjectName', () => {
  it('trims and lowercases valid names', () => {
    expect(normalizeProjectName('  UI-Lib ')).toBe('ui-lib')
  })

  it('returns empty for missing or invalid values', () => {
    expect(normalizeProjectName('')).toBe('')
    expect(normalizeProjectName(undefined)).toBe('')
    expect(normalizeProjectName('not a name!')).toBe('')
  })
})

describe('resolveProjectName', () => {
  it('prefers the CLI flag over the env', () => {
    expect(resolveProjectName({ flag: 'ui-lib', env: { VERCEL_PROJECT: 'other' } })).toBe('ui-lib')
  })

  it('falls back to VERCEL_PROJECT from the merged env', () => {
    expect(resolveProjectName({ flag: '', env: { VERCEL_PROJECT: 'codepg-tts' } })).toBe('codepg-tts')
  })

  it('resolves empty when neither source names a project', () => {
    expect(resolveProjectName({ flag: '', env: {} })).toBe('')
  })

  it('throws on present-but-invalid values instead of prompting', () => {
    expect(() => resolveProjectName({ flag: 'bad name', env: {} })).toThrowError(/Invalid Vercel project name/)
    expect(() => resolveProjectName({ flag: '', env: { VERCEL_PROJECT: 'bad name' } })).toThrowError(
      /Invalid VERCEL_PROJECT/,
    )
  })
})

describe('defaultProjectName', () => {
  it('derives the prompt default from the package name', () => {
    expect(defaultProjectName('ui-lib')).toBe('ui-lib')
    expect(defaultProjectName('not a name!')).toBe('')
  })
})

describe('decideLinkAction', () => {
  it('keeps the link when nothing new is requested', () => {
    expect(decideLinkAction({ linked: 'ui-lib', requested: '' })).toEqual({ action: 'keep', name: 'ui-lib' })
  })

  it('keeps the link when the request matches', () => {
    expect(decideLinkAction({ linked: 'ui-lib', requested: 'ui-lib' })).toEqual({
      action: 'keep',
      name: 'ui-lib',
    })
  })

  it('links an unlinked checkout when a name is requested', () => {
    expect(decideLinkAction({ linked: '', requested: 'ui-lib' })).toEqual({ action: 'link', name: 'ui-lib' })
  })

  it('switches the link when a different name is requested', () => {
    expect(decideLinkAction({ linked: 'codepg-tts', requested: 'tts' })).toEqual({
      action: 'switch',
      name: 'tts',
      from: 'codepg-tts',
    })
  })

  it('reports missing for an unlinked checkout with no request', () => {
    expect(decideLinkAction({ linked: '', requested: '' })).toEqual({ action: 'missing', name: '' })
  })

  it('normalizes both sides before comparing', () => {
    expect(decideLinkAction({ linked: 'UI-Lib', requested: 'ui-lib' })).toEqual({
      action: 'keep',
      name: 'ui-lib',
    })
  })
})

describe('upsertEnvLine', () => {
  it('replaces an existing entry in place', () => {
    const content = 'PROFILE=prod\nVERCEL_PROJECT=old\nDATABASE_URL=x\n'
    expect(upsertEnvLine(content, 'VERCEL_PROJECT', 'ui-lib')).toBe(
      'PROFILE=prod\nVERCEL_PROJECT=ui-lib\nDATABASE_URL=x\n',
    )
  })

  it('appends a missing entry and keeps the trailing newline singular', () => {
    expect(upsertEnvLine('PROFILE=prod\n', 'VERCEL_PROJECT', 'ui-lib')).toBe('PROFILE=prod\nVERCEL_PROJECT=ui-lib\n')
    expect(upsertEnvLine('', 'VERCEL_PROJECT', 'ui-lib')).toBe('VERCEL_PROJECT=ui-lib\n')
  })

  it('ignores commented entries and appends instead', () => {
    const content = '# VERCEL_PROJECT=old\nPROFILE=prod\n'
    expect(upsertEnvLine(content, 'VERCEL_PROJECT', 'ui-lib')).toBe(
      '# VERCEL_PROJECT=old\nPROFILE=prod\nVERCEL_PROJECT=ui-lib\n',
    )
  })
})
