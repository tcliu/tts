#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'
import { parseEnvFile } from './env-file.mjs'

export { parseEnvFile }

export function loadScriptEnv(env = process.env) {
  return {
    ...parseEnvFile('.env'),
    ...parseEnvFile('.env.local'),
    ...parseEnvFile('.env.vercel'),
    ...env,
  }
}

export function getDatabaseURL(env = process.env) {
  const loadedEnv = loadScriptEnv(env)
  return (loadedEnv.DATABASE_URL || '').trim()
}

export function resolveScriptProfile(env = process.env) {
  const explicit = (env.PROFILE || '').trim().toLowerCase()
  if (explicit === 'dev' || explicit === 'prod') return explicit

  const mergedProfile = (loadScriptEnv(env).PROFILE || '').trim().toLowerCase()
  if (mergedProfile === 'dev' || mergedProfile === 'prod') return mergedProfile

  return 'dev'
}

export function getSqlitePath(env = process.env) {
  const loadedEnv = loadScriptEnv(env)
  return (loadedEnv.SQLITE_PATH || '.data/dev.sqlite').trim()
}
export function getSchemaName(env = process.env) {
  const loadedEnv = loadScriptEnv(env)
  return (loadedEnv.SCHEMA_NAME || '').trim()
}

// Absolute path of the schema source both apply flows read
// (apply-schema.mjs for Neon/SQLite, apply-d1-schema.mjs for D1).
// `root` is injectable so tests can point at a fixture dir; production
// callers omit it (repo root).
export function neonSchemaPath(root = join(dirname(fileURLToPath(import.meta.url)), '..')) {
  return join(root, 'sql', 'schema.sql')
}

// Whether there is a schema file to apply: without one the deploy
// interview skips the apply-schema question instead of asking it.
export function hasNeonSchema(root) {
  try {
    return existsSync(neonSchemaPath(root))
  } catch {
    return false
  }
}

// Host/database identifiers for log lines. Never returns credentials —
// only the hostname and path the operator needs to find the database.
export function describeDatabaseTarget(databaseURL) {
  try {
    const url = new URL(databaseURL)
    return {
      host: url.hostname || 'unknown',
      database: url.pathname.replace(/^\//, '') || 'unknown',
    }
  } catch {
    return { host: 'unknown', database: 'unknown' }
  }
}

// Quote a Postgres identifier for DDL. Identifiers cannot be parameterized,
// so quoting is the only safe path for values that are legitimately
// interpolated. Quoted identifiers may contain any character except NUL, so
// the only unsafe input is an embedded double quote — doubled to escape it
// (`"` -> `""`).
export function quoteIdentifier(name) {
  if (typeof name !== 'string' || !name || name.includes('\u0000')) {
    throw new Error(`Invalid identifier: ${String(name)}`)
  }
  return `"${name.replace(/"/g, '""')}"`
}

export function toSqliteSql(sql) {
  return sql
    .replace(/\$\d+/g, () => '?')
    .replaceAll('bigserial', 'integer')
    .replaceAll('current_timestamp', "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
}

export function createDbPool(env = process.env) {
  const databaseURL = getDatabaseURL(env)

  if (!databaseURL) {
    throw new Error('Missing DATABASE_URL for database access')
  }

  return new Pool({
    connectionString: databaseURL,
    max: 10,
  })
}
