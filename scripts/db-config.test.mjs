import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { hasNeonSchema, neonSchemaPath } from './db-config.mjs'

describe('neonSchemaPath', () => {
  it('points at sql/schema.sql under the root', () => {
    expect(neonSchemaPath('/repo')).toBe(join('/repo', 'sql', 'schema.sql'))
  })
})

describe('hasNeonSchema', () => {
  it('detects a present schema file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'schema-present-'))
    mkdirSync(join(dir, 'sql'), { recursive: true })
    writeFileSync(join(dir, 'sql', 'schema.sql'), 'create table t (id integer);\n')
    expect(hasNeonSchema(dir)).toBe(true)
  })

  it('reports a missing schema file', () => {
    expect(hasNeonSchema(mkdtempSync(join(tmpdir(), 'schema-missing-')))).toBe(false)
  })
})
