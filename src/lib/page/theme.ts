import MoonIcon from '$lib/icons/MoonIcon.svelte'
import FireIcon from '$lib/icons/FireIcon.svelte'
import ForestIcon from '$lib/icons/ForestIcon.svelte'
import MidnightIcon from '$lib/icons/MidnightIcon.svelte'
import SparklesIcon from '$lib/icons/SparklesIcon.svelte'
import SunIcon from '$lib/icons/SunIcon.svelte'
import MintIcon from '$lib/icons/MintIcon.svelte'
import LightBulbIcon from '$lib/icons/LightBulbIcon.svelte'
import LavenderIcon from '$lib/icons/LavenderIcon.svelte'
import CloudIcon from '$lib/icons/CloudIcon.svelte'
import type { UiTheme } from '$lib/use-settings.svelte'

export const THEME_MENU_OPTIONS: { value: UiTheme }[] = [
  { value: 'dark' },
  { value: 'ember' },
  { value: 'forest' },
  { value: 'midnight' },
  { value: 'nebula' },
  { value: 'light' },
  { value: 'mint' },
  { value: 'sepia' },
  { value: 'lavender' },
  { value: 'sky' },
]

export const THEME_ICONS: Record<UiTheme, typeof MoonIcon> = {
  dark: MoonIcon,
  ember: FireIcon,
  forest: ForestIcon,
  midnight: MidnightIcon,
  nebula: SparklesIcon,
  light: SunIcon,
  mint: MintIcon,
  sepia: LightBulbIcon,
  lavender: LavenderIcon,
  sky: CloudIcon,
}
