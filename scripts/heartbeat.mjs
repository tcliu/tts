#!/usr/bin/env node
// Standalone prod heartbeat switch (no deploy): syncs the cron-job.org
// scan job that calls GET /api/cron/scan.
//
// Usage:
//   node scripts/heartbeat.mjs [--target vercel|cloudflare] [--provider cron-job|none]
// Missing and interactive: arrow-key picker (default cron-job).
// Missing and non-interactive: abort.
import { applyHeartbeat, HEARTBEAT_CHOICES, HEARTBEAT_PROVIDERS, renderOptionPicker } from './lib/heartbeat.mjs'
import { resolveCloudflareAppUrl } from './lib/cloudflare.mjs'
import { loadTargetEnv } from './lib/target-env.mjs'
import { c } from './_terminal.mjs'
import { interactiveShell } from './_interactive-shell.mjs'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function usage() {
  console.log(`Usage:
  node scripts/heartbeat.mjs [--target vercel|cloudflare] [--provider cron-job|none]

Targets (--target):
  vercel       Point the scan job at the Vercel deployment (default).
  cloudflare   Point the scan job at the Cloudflare Pages deployment.

Providers (--provider):
  cron-job   Upsert + enable the cron-job.org scan job (needs
             CRONJOB_API_KEY).
  none       Disable the scan job.

Options:
  --target vercel|cloudflare
                        Missing and interactive: picker (default vercel).
                        Missing and non-interactive: vercel.
  --provider cron-job|none
                       Missing and interactive: picker (default cron-job).
                       Missing and non-interactive: abort.

Examples:
  npm run heartbeat -- --provider cron-job
  npm run heartbeat -- --target cloudflare --provider cron-job
  npm run heartbeat -- --target cloudflare --provider none`)
}

function parseArgs(argv) {
  const options = { providerFlag: '', targetFlag: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg.startsWith('--target=')) {
      options.targetFlag = arg.slice('--target='.length)
    } else if (arg === '--target') {
      options.targetFlag = next || ''
      if (next !== undefined) i++
    } else if (arg.startsWith('--provider=')) {
      options.providerFlag = arg.slice('--provider='.length)
    } else if (arg === '--provider') {
      options.providerFlag = next || ''
      if (next !== undefined) i++
    } else if (arg === '-h' || arg === '--help' || arg === 'help') {
      usage()
      process.exit(0)
    } else {
      fail(`Unknown option: ${arg}`)
    }
  }
  return options
}

async function pickProvider() {
  const node = {
    message: 'Sync the cron-job.org auto-scan heartbeat?',
    async process(ctx) {
      const picked = await ctx.selectOne(HEARTBEAT_CHOICES, {
        defaultValue: 'cron-job',
        render: renderOptionPicker('default cron-job.org'),
      })
      if (!picked) {
        fail('Heartbeat switch cancelled.')
      }
      ctx.provider = picked.value
      return null
    },
  }
  const answers = await interactiveShell(node, {
    options: { ctx: { provider: '' }, output: process.stderr },
    chrome: { cancelText: `${c.yellow}Heartbeat switch cancelled.${c.reset}` },
  })
  return answers.provider
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.targetFlag && options.targetFlag !== 'vercel' && options.targetFlag !== 'cloudflare') {
    fail(`Unknown target: ${options.targetFlag} (expected vercel|cloudflare).`)
  }
  const target = options.targetFlag || 'vercel'
  if (options.providerFlag && !HEARTBEAT_PROVIDERS.includes(options.providerFlag)) {
    fail(`Unknown provider: ${options.providerFlag} (expected cron-job|none).`)
  }
  let provider = options.providerFlag
  if (!provider) {
    if (!process.stdin.isTTY) {
      fail('Missing provider: pass --provider cron-job|none or run interactively.')
    }
    provider = await pickProvider()
  }
  try {
    // The Cloudflare live URL is the Pages production domain derived from
    // the project: resolve it instead of reading APP_BASE_URL (absent on
    // that target). Wrangler authenticates from the process env, so seed
    // the operator token from .env.local first — shell values always win.
    let baseUrl
    if (target === 'cloudflare') {
      const merged = loadTargetEnv('cloudflare', process.cwd())
      for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
        if (!process.env[key] && String(merged[key] || '').trim()) {
          process.env[key] = String(merged[key]).trim()
        }
      }
      baseUrl = resolveCloudflareAppUrl()
    }
    await applyHeartbeat(provider, undefined, target, { baseUrl })
  } catch (error) {
    fail(error?.message || error)
  }
  console.log(`OK heartbeat -> ${provider} (${target})`)
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
