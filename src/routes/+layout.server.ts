import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async () => {
  const devTag = (process.env.DEV_TAG || '').trim()
  return { devTag: devTag || null }
}
