#!/usr/bin/env node

import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  createDbPool,
  describeDatabaseTarget,
  getDatabaseURL,
  getSchemaName,
  getSqlitePath,
  quoteIdentifier,
  resolveScriptProfile,
  toSqliteSql,
} from './db-config.mjs'

// Structured log line matching src/lib/server/logging:
// `<ISO timestamp> <LEVEL> ip=<ip> action=<action> <key>=<JSON value> ...`.
// Scripts run without a request context, so ip is always unknown. Never log
// connection strings, secrets, or document contents — only host/db identifiers.
function logEvent({ action, details = {} }) {
  const timestamp = new Date().toISOString()
  const defaultLevel = action.endsWith('_error') ? 'ERROR' : 'INFO'
  const { level, ...rest } = details
  const resolvedLevel = level === 'INFO' || level === 'WARN' || level === 'ERROR' ? level : defaultLevel
  const serializedDetails = Object.entries(rest)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
  console.log(
    `${timestamp} ${resolvedLevel} ip=unknown action=${action}${serializedDetails ? ` ${serializedDetails}` : ''}`,
  )
}
function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error.message === 'string' && error.message) return error.message
  return String(error)
}

// Split a SQL script into statements on semicolons that are not inside a
// string literal, quoted identifier, line comment, or block comment. The
// naive `sql.split(';')` breaks on semicolons inside `--` comments in
// sql/schema.sql, producing a chunk starting with bare text
// ("version rows are removed ...") that Neon rejects with
// `syntax error at or near "version"`.
function splitSqlStatements(sql) {
  const statements = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    const next = sql[i + 1]
    if (inLineComment) {
      current += char
      if (char === '\n') inLineComment = false
    } else if (inBlockComment) {
      current += char
      if (char === '*' && next === '/') {
        current += next
        i++
        inBlockComment = false
      }
    } else if (inSingleQuote) {
      current += char
      if (char === "'" && next === "'") {
        current += next
        i++
      } else if (char === "'") {
        inSingleQuote = false
      }
    } else if (inDoubleQuote) {
      current += char
      if (char === '"' && next === '"') {
        current += next
        i++
      } else if (char === '"') {
        inDoubleQuote = false
      }
    } else if (char === '-' && next === '-') {
      inLineComment = true
      current += char
    } else if (char === '/' && next === '*') {
      inBlockComment = true
      current += char
    } else if (char === "'") {
      inSingleQuote = true
      current += char
    } else if (char === '"') {
      inDoubleQuote = true
      current += char
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

const profile = resolveScriptProfile()
const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8')
const startedAt = Date.now()

if (profile === 'dev') {
  const path = getSqlitePath()
  logEvent({ action: 'schema_apply_start', details: { profile, source: 'sql/schema.sql', sqlite_path: path } })
  try {
    const { default: Database } = await import('better-sqlite3')

    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true })
    }

    const database = new Database(path)
    try {
      database.exec(toSqliteSql(sql))
      const tables = database
        .prepare(
          "select name from sqlite_master where type = 'table' and name in ('users', 'user_documents') order by name",
        )
        .map(row => row.name)
      logEvent({
        action: 'schema_apply_end',
        details: { profile, sqlite_path: path, elapsed_ms: Date.now() - startedAt, tables },
      })
    } finally {
      database.close()
    }
  } catch (error) {
    logEvent({
      action: 'schema_apply_error',
      details: { profile, sqlite_path: path, elapsed_ms: Date.now() - startedAt, error: errorMessage(error) },
    })
    process.exitCode = 1
  }
} else {
  const { host: db_host, database: db_name } = describeDatabaseTarget(getDatabaseURL())
  const schemaName = getSchemaName()
  const schema = schemaName || 'public'
  logEvent({
    action: 'schema_apply_start',
    details: { profile, source: 'sql/schema.sql', db_host, db_name, schema },
  })
  const pool = createDbPool()
  try {
    // One client for the whole apply so `set search_path` covers the DDL and
    // the verification query. The app reads through the same search_path (see
    // src/lib/server/db-neon.ts), so DDL must land in SCHEMA_NAME — without
    // this the tables are created in public while the app looks in tts.
    const client = await pool.connect()
    try {
      if (schemaName) {
        await client.query(`create schema if not exists ${quoteIdentifier(schemaName)}`)
        await client.query(`set search_path to ${quoteIdentifier(schemaName)}`)
      }
      const statements = splitSqlStatements(sql)
      for (const statement of statements) {
        await client.query(statement)
      }
      const tables = (
        await client.query(
          'select table_name from information_schema.tables where table_schema = $1 and table_name in ($2, $3) order by table_name',
          [schema, 'users', 'user_documents'],
        )
      ).rows.map(row => row.table_name)
      const location = (
        await client.query('select current_database() as current_database, current_schema() as current_schema')
      ).rows[0]
      logEvent({
        action: 'schema_apply_end',
        details: {
          profile,
          db_host,
          db_name,
          schema,
          elapsed_ms: Date.now() - startedAt,
          tables,
          current_database: location.current_database,
          current_schema: location.current_schema,
        },
      })
    } finally {
      client.release()
    }
  } catch (error) {
    logEvent({
      action: 'schema_apply_error',
      details: { profile, db_host, db_name, schema, elapsed_ms: Date.now() - startedAt, error: errorMessage(error) },
    })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
