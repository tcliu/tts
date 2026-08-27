import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

const DEV_ENV_FILES = ['.env', '.env.local', '.env.dev']

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const values: Record<string, string> = {}
  const content = readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function loadDevEnv() {
  const merged: Record<string, string> = {}
  for (const file of DEV_ENV_FILES) {
    const entries = Object.entries(parseEnvFile(path.resolve(process.cwd(), file))) as [string, string][]
    for (const [key, value] of entries) {
      merged[key] = value
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

export default defineConfig(async ({ command, mode }) => {
  if (command === 'serve' && mode === 'development') {
    loadDevEnv()
  }
  return {
    plugins: [sveltekit(), tailwindcss()],
    test: {
      include: ['src/**/*.{test,spec}.{ts,js}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/vitest-setup.ts'],
    },
  }
})
