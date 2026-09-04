import type { UiLocale, UiText } from '../ui-text'
import { en } from './en'
import { zhTW } from './zh-TW'
import { zhCN } from './zh-CN'

export const UI_TEXT: Record<UiLocale, UiText> = {
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
}
