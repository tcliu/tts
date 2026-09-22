import adapterCloudflare from '@sveltejs/adapter-cloudflare'
import adapterVercel from '@sveltejs/adapter-vercel'

// Second deploy target: `CF_PAGES=1` selects the Cloudflare Pages adapter,
// otherwise the Vercel adapter stays the default. Deploys run through
// `scripts/deploy.mjs --target cloudflare` on the existing Neon backend.
const useCloudflare = process.env.CF_PAGES === '1'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: useCloudflare ? adapterCloudflare() : adapterVercel({ runtime: 'nodejs24.x' }),
  },
}

export default config
