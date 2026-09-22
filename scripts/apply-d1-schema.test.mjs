import { describe, expect, it } from 'vitest'

import { parseSchemaQualifier, parseSchemaTableNames } from './apply-d1-schema.mjs'

describe('parseSchemaQualifier', () => {
  it('reads the CREATE SCHEMA name', () => {
    expect(parseSchemaQualifier('create schema if not exists "project-catalog";')).toBe('"project-catalog".')
    expect(parseSchemaQualifier('CREATE SCHEMA analytics;')).toBe('"analytics".')
  })

  it('returns empty for unqualified schemas', () => {
    expect(parseSchemaQualifier('create table users (id integer);')).toBe('')
    expect(parseSchemaQualifier('')).toBe('')
  })
})

describe('parseSchemaTableNames', () => {
  it('reads translated table names, quoted and bare', () => {
    const ddl = [
      'create table "projects" (',
      'id text primary key',
      ');',
      'create table if not exists users (',
      'id integer primary key',
      ');',
    ].join('\n')
    expect(parseSchemaTableNames(ddl)).toEqual(['projects', 'users'])
  })

  it('ignores drops, indexes, and duplicates', () => {
    expect(parseSchemaTableNames('drop table if exists x;\ncreate index i on t (c);')).toEqual([])
    expect(parseSchemaTableNames('create table t (a);\ncreate table t (a);')).toEqual(['t'])
  })
})
