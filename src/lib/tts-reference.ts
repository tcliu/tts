import { franc } from 'franc-min'
import referenceLanguages from './reference-languages.json'
import { mergeBracketRanges as mergeBracketRangesShared } from './bracket-merge'

export interface TtsVoice {
  name: string
  gender: 'Female' | 'Male'
  source: 'edge'
  edge: string
  group?: string
}

export interface TtsLanguage {
  code: string
  name: string
  voices: TtsVoice[]
  aliases?: string[]
}

export interface TtsSegment {
  text: string
  lang: string
  indexStart: number
  indexEnd: number
}

export interface HighlightRange {
  start: number
  end: number
  lang: string
}

export interface TtsBoundary {
  offset: number
  at: number
  duration?: number
  text?: string
}

export interface EdgeBoundaryEvent {
  type: 'WordBoundary' | 'SentenceBoundary'
  offset: number
  duration?: number
  text: string
}

export function parseEdgeMetadata(message: string): EdgeBoundaryEvent[] {
  const separator = message.indexOf('\r\n\r\n')
  const jsonPart = separator >= 0 ? message.slice(separator + 4) : message
  let data: {
    Metadata?: {
      Type?: string
      Data?: { Offset?: number; Duration?: number; text?: { Text?: string } }
    }[]
  }
  try {
    data = JSON.parse(jsonPart)
  } catch {
    return []
  }
  if (!Array.isArray(data?.Metadata)) return []
  const events: EdgeBoundaryEvent[] = []
  for (const item of data.Metadata) {
    const type = item?.Type
    const offset = Number(item?.Data?.Offset)
    const duration = Number(item?.Data?.Duration)
    const text = item?.Data?.text?.Text ?? ''
    if ((type === 'WordBoundary' || type === 'SentenceBoundary') && Number.isFinite(offset)) {
      events.push({
        type,
        offset,
        duration: Number.isFinite(duration) ? duration : undefined,
        text,
      })
    }
  }
  return events
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

export const SPEED_OPTIONS = SPEEDS.map(value => ({ value: String(value), label: `${value}x` }))

export const REFERENCE_LANGUAGES: TtsLanguage[] = referenceLanguages as TtsLanguage[]

const MAX_SEGMENT_LENGTH = 500
const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/
const SEGMENT_CJK_RE = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u3040-\u30ff\u0400-\u052f]/
const SINGLE_CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u3130-\u318f]/
const PUNCT_KEEP_RE = /[.!?。！？…·•\-—─，、,;；:：]/
const PUNCT_ONLY_RE = /^[.!?。！？…·•\-—─，、,;；:：]+$/
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const DEVANAGARI_RE = /[\u0900-\u097F]/
const BENGALI_RE = /[\u0980-\u09FF]/
const GUJARATI_RE = /[\u0A80-\u0AFF]/
const GURMUKHI_RE = /[\u0A00-\u0A7F]/
const TAMIL_RE = /[\u0B80-\u0BFF]/
const TELUGU_RE = /[\u0C00-\u0C7F]/
const KANNADA_RE = /[\u0C80-\u0CFF]/
const MALAYALAM_RE = /[\u0D00-\u0D7F]/
const SINHALA_RE = /[\u0D80-\u0DFF]/
const THAI_RE = /[\u0E00-\u0E7F]/
const LAO_RE = /[\u0E80-\u0EFF]/
const MYANMAR_RE = /[\u1000-\u109F]/
const GEORGIAN_RE = /[\u10A0-\u10FF]/
const ETHIOPIC_RE = /[\u1200-\u137F]/
const CANADIAN_ABORIGINAL_RE = /[\u1400-\u167F]/
const KHMER_RE = /[\u1780-\u17FF]/
const GREEK_RE = /[\u0370-\u03FF]/
const HEBREW_RE = /[\u0590-\u05FF]/
const ARMENIAN_RE = /[\u0530-\u058F]/

export function defaultVoiceByLanguage(): Record<string, string> {
  return Object.fromEntries(REFERENCE_LANGUAGES.map(language => [language.code, language.voices[0]?.edge ?? '']))
}

export function defaultGroupByLanguage(): Record<string, string> {
  return Object.fromEntries(
    REFERENCE_LANGUAGES.map(language => [language.code, getVoiceGroups(language.code)[0] ?? '']),
  )
}

export function getVoiceGroups(languageCode: string): string[] {
  const language = REFERENCE_LANGUAGES.find(item => item.code === languageCode)
  if (!language) return []
  const groups = Array.from(new Set(language.voices.map(voice => voice.group).filter(Boolean)))
  return groups as string[]
}

export function getVoiceOptions(languageCode: string, group = ''): TtsVoice[] {
  const language = REFERENCE_LANGUAGES.find(item => item.code === languageCode)
  if (!language) return []
  const groups = getVoiceGroups(languageCode)
  if (groups.length === 0) {
    return language.voices
  }
  return language.voices.filter(voice => voice.group === group)
}

export function voiceForSelection(languageCode: string, voiceId: string, group = ''): TtsVoice | undefined {
  const language = REFERENCE_LANGUAGES.find(item => item.code === languageCode)
  if (!language) return undefined
  const options = getVoiceOptions(languageCode, group)
  if (options.length > 0) {
    return options.find(option => option.edge === voiceId) ?? options[0]
  }
  return language.voices.find(option => option.edge === voiceId) ?? language.voices[0]
}

const FRANC_TO_LANGUAGE: Record<string, string> = {
  eng: 'en', cmn: 'zh', yue: 'yue', jpn: 'ja', kor: 'ko', spa: 'es', fra: 'fr', rus: 'ru',
  afr: 'af', amh: 'am', arb: 'ar', aze: 'az', bul: 'bg', ben: 'bn', bos: 'bs', cat: 'ca',
  ces: 'cs', cym: 'cy', dan: 'da', deu: 'de', ell: 'el', est: 'et', pes: 'fa', fin: 'fi',
  fil: 'fil', gle: 'ga', glg: 'gl', guj: 'gu', heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu',
  ind: 'id', isl: 'is', ita: 'it', iku: 'iu', jav: 'jv', kat: 'ka', kaz: 'kk', khm: 'km',
  kan: 'kn', lao: 'lo', lit: 'lt', lav: 'lv', mkd: 'mk', mal: 'ml', mon: 'mn', mar: 'mr',
  msa: 'ms', mlt: 'mt', mya: 'my', nob: 'nb', nep: 'ne', nld: 'nl', pol: 'pl', pus: 'ps',
  por: 'pt', ron: 'ro', sin: 'si', slk: 'sk', slv: 'sl', som: 'so', sqi: 'sq', srp: 'sr',
  sun: 'su', swe: 'sv', swa: 'sw', tam: 'ta', tel: 'te', tha: 'th', tur: 'tr', ukr: 'uk',
  urd: 'ur', uzb: 'uz', vie: 'vi', zul: 'zu',
}

// Spoken variants collapse to their written language so the language chip and
// voice list stay written-only. Cantonese (yue) is a spoken variant of Chinese
// (zh); British/American English etc. are already written `en` from detection.
// The mapping is driven by each language's `aliases` in reference-languages.json,
// so adding a dialect (e.g. nan/Hokkien under zh) collapses with a JSON-only
// change; a fixed voice group additionally needs an entry in SPOKEN_GROUP below.
const SPOKEN_TO_WRITTEN: Record<string, string> = Object.fromEntries(
  REFERENCE_LANGUAGES.flatMap(lang => (lang.aliases ?? []).map(alias => [alias, lang.code])),
)
export function toWrittenLang(code: string): string {
  return SPOKEN_TO_WRITTEN[code] ?? code
}

// Some spoken variants have a fixed voice group (e.g. yue is always the
// Cantonese group of zh). Keep this alongside SPOKEN_TO_WRITTEN so the
// group mapping is also data-adjacent rather than scattered ternaries.
export const SPOKEN_GROUP: Record<string, string> = {
  yue: 'Cantonese',
}
const ENGLISH_WORDS = new Set([
  'the', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'that', 'this', 'these', 'those', 'it', 'its',
  'as', 'we', 'you', 'they', 'he', 'she', 'me', 'my', 'your', 'our', 'their', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'do', 'does', 'did', 'not',
  'no', 'yes', 'if', 'then', 'so', 'because', 'when', 'where', 'what', 'who', 'how', 'all', 'each',
  'every', 'some', 'any', 'most', 'more', 'much', 'many', 'one', 'two', 'first', 'good', 'time',
  'day', 'year', 'people', 'world', 'into', 'out', 'up', 'down', 'over', 'under', 'again', 'back',
  'just', 'like', 'know', 'think', 'see', 'come', 'take', 'make', 'go', 'get', 'new', 'now', 'here',
  'there', 'also', 'well', 'way', 'even', 'only', 'other', 'such', 'very', 'great', 'small', 'large',
  'said', 'hello', 'world', 'morning', 'today', 'weather', 'nice', 'love', 'programming', 'quick',
  'brown', 'fox', 'jumps', 'lazy', 'dog', 'emergency', 'broadcast', 'system', 'second', 'segment',
])
const ENGLISH_DISTINCTIVE_RE =
  /\b(the|and|hello|world|you|that|have|with|this|from|they|what|about|which|when|make|like|time|just|know|take|people|into|year|your|good|some|could|them|see|other|than|then|now|look|only|come|over|think|also|back|after|use|how|our|work|first|well|way|even|new|want|because|any|these|give|day|most|us|are|was|were|been|has|had|will|would|should|can|good|morning|today|weather|nice|love|programming|quick|brown|fox|jumps|over|lazy|dog|emergency|broadcast|system|hello|world|second|segment|here)\b/i
function englishWordScore(text: string): number {
  const tokens = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
  let score = 0
  for (const t of tokens) if (ENGLISH_WORDS.has(t)) score += 1
  return score
}
const FOREIGN_WORDS: Record<string, string[]> = {
  de: ['hallo', 'welt', 'danke', 'bitte', 'guten', 'tag', 'wie', 'geht', 'es', 'dir', 'und', 'der', 'die', 'das', 'ein', 'eine', 'ist', 'nicht', 'ich', 'du', 'wir', 'ja', 'nein', 'gut', 'schön', 'morgen', 'abend'],
  nl: ['hallo', 'wereld', 'dank', 'alsjeblieft', 'ja', 'nee', 'goedemorgen', 'goed', 'avond', 'dit', 'een', 'van', 'het', 'niet', 'wat', 'wij', 'jullie', 'zijn', 'dankje'],
  fr: ['bonjour', 'monde', 'merci', 'plait', 'plaît', 'oui', 'non', 'salut', 'comment', 'allez', 'vous', 'bien', 'au', 'revoir', 'pour', 'lui', 'les', 'enfants', 'ce', 'moment', 'calme', 'soir', 'offre', 'tous', 'la', 'opportunité', 'opportunite', 'chaque', 'matin', 'vent', 'souffle', 'doucement', 'demain', 'sera', 'autre', 'jour', 'rempli', 'nouvelles', 'possibilités', 'possibilites'],
  es: ['hola', 'mundo', 'gracias', 'favor', 'buenos', 'dias', 'días', 'como', 'cómo', 'estas', 'estás', 'bien', 'adios', 'adiós', 'hasta', 'luego', 'si', 'sí', 'no', 'durante', 'fin', 'semana', 'muchas', 'personas', 'todos', 'compartimos', 'mismo', 'deseo', 'fundamental', 'armonía', 'armonia', 'una', 'dulce', 'melodía', 'melodia', 'músico', 'musico', 'callejero', 'ofrece', 'oportunidad', 'respirar', 'profundamente', 'recordar', 'bello', 'vida'],
  it: ['ciao', 'mondo', 'grazie', 'prego', 'buongiorno', 'come', 'stai', 'bene', 'arrivederci', 'si', 'no', 'molte', 'persone', 'preferiscono', 'passeggiare', 'lungo', 'viali', 'serali', 'questo', 'luogo', 'incantevole', 'veramente', 'tesoro', 'inestimabile', 'chiunque', 'cerchi', 'pace'],
  pt: ['olá', 'ola', 'mundo', 'obrigado', 'favor', 'sim', 'não', 'nao', 'bom', 'dia', 'como', 'está', 'esta', 'bem', 'adeus', 'até', 'ate', 'logo', 'vida', 'lindo', 'fala', 'português', 'bonito'],
  pl: ['cześć', 'czesc', 'świat', 'swiat', 'dziękuję', 'dziekuje', 'proszę', 'prosze', 'tak', 'nie', 'witaj', 'dobry', 'dzień', 'dzien', 'jak', 'się', 'sie', 'masz'],
  tr: ['merhaba', 'dünya', 'dunya', 'teşekkür', 'tesekkur', 'lütfen', 'lutfen', 'evet', 'hayır', 'hayir', 'günaydın', 'gunaydin', 'nasıl', 'nasil', 'sin', 'iyi'],
  sv: ['hej', 'världen', 'varlden', 'tack', 'ja', 'nej', 'god', 'morgon', 'hur', 'mår', 'mar', 'du', 'bra'],
  da: ['hej', 'verden', 'tak', 'ja', 'nej', 'godmorgen', 'hvordan', 'har', 'du', 'det', 'bra'],
  nb: ['hei', 'verden', 'takk', 'ja', 'nei', 'god', 'morgen', 'hvordan', 'har', 'du', 'det', 'bra'],
  fi: ['hei', 'maailma', 'kiitos', 'ole', 'hyvä', 'hyva', 'kyllä', 'kylla', 'ei', 'huomenta', 'miten', 'voit', 'hyvin'],
  cs: ['ahoj', 'svět', 'svet', 'děkuji', 'dekuji', 'prosím', 'prosim', 'ano', 'ne', 'dobrý', 'dobry', 'den', 'jak', 'se', 'máš', 'mas'],
  sk: ['ahoj', 'svet', 'ďakujem', 'dakujem', 'prosím', 'prosim', 'áno', 'ano', 'nie', 'dobrý', 'dobry', 'den', 'ako', 'sa', 'máš', 'mas', 'všetkých', 'krásny', 'krásna'],
  hu: ['szia', 'világ', 'vilag', 'köszönöm', 'koszonom', 'kérem', 'kerem', 'igen', 'nem', 'jó', 'jo', 'reggelt', 'hogy', 'vagy', 'jól', 'jol'],
  ro: ['salut', 'lume', 'mulțumesc', 'multumesc', 'vă', 'va', 'rog', 'da', 'nu', 'bună', 'buna', 'ziua', 'ce', 'faci', 'bine'],
  id: ['halo', 'dunia', 'terima', 'kasih', 'ya', 'tidak', 'selamat', 'pagi', 'apa', 'kabar', 'baik'],
  ms: ['halo', 'dunia', 'terima', 'kasih', 'ya', 'tidak', 'selamat', 'pagi', 'apa', 'khabar', 'baik'],
  vi: ['xin', 'chào', 'chao', 'thế', 'the', 'giới', 'gioi', 'cảm', 'cam', 'ơn', 'on', 'vâng', 'vang', 'không', 'khong', 'tôi', 'toi', 'khỏe', 'khoe', 'bạn', 'ban'],
  af: ['lekker', 'baie', 'nie', 'ek', 'jy', 'vandag', 'gaan', 'gedoen', 'dankie', 'afrikaans', 'hoe'],
  az: ['və', 'necə', 'sən', 'mən', 'deyil', 'yox', 'salam', 'dünya', 'həyat', 'gözəl', 'insan'],
  bs: ['šta', 'svijet', 'prijatelj', 'dobro', 'dobar', 'jutro', 'gdje', 'nek', 'zdravo'],
  ca: ['món', 'avui', 'bonica', 'estàs', 'país', 'terra', 'llengua', 'som', 'fem', 'són', 'hola'],
  cy: ['helo', 'byd', 'yma', 'mae', 'nhw', 'pob', 'dyn', 'cymru', 'dydd', 'eich', 'defnyddio', 'gallu'],
  et: ['kuidas', 'täna', 'hommik', 'ilus', 'maailm', 'ole', 'ja', 'ei', 'kas', 'nad', 'on'],
  fil: ['kumusta', 'magandang', 'umaga', 'ako', 'ikaw', 'siya', 'kami', 'kayo', 'sila', 'tayo', 'ang', 'ng'],
  ga: ['dia', 'duit', 'domhan', 'maidin', 'mhaith', 'gaeilge', 'slán', 'tá', 'mé', 'bhfuil', 'ár', 'bhur', 'le', 'ag'],
  gl: ['fermosa', 'hoxe', 'compostela', 'nosa', 'fala', 'terra', 'bonita', 'está', 'ola', 'mundo'],
  hr: ['što', 'lijep', 'dobar', 'svijet', 'prijatelj', 'jutro', 'gdje', 'nek', 'zdravo'],
  is: ['heimur', 'góðan', 'daginn', 'allir', 'ég', 'þú', 'hann', 'við', 'þið', 'eru', 'ekki', 'hvað', 'hver', 'frábær', 'vel', 'og'],
  jv: ['donya', 'lan', 'urip', 'apik', 'kula', 'sampeyan', 'sliramu', 'inggih', 'punika', 'matur', 'nggeh'],
  lt: ['sveikas', 'pasauli', 'ryto', 'metas', 'labas', 'rytas', 'kaip', 'jūs', 'yra', 'aš', 'tu', 'mes'],
  lv: ['sveiks', 'pasaule', 'rītu', 'visiem', 'labu', 'labdien', 'rīts', 'kā', 'jūs', 'mēs', 'viņš'],
  mt: ['dinja', 'ħajja', 'sabiħa', 'kulħadd', 'lil', 'jien', 'int', 'intom', 'huma', 'iva', 'kif', 'fejn', 'sbieħ', 'tajba'],
  sl: ['zdravo', 'lep', 'lepa', 'dober', 'jutro', 'vsi', 'kako', 'so', 'za', 'vse'],
  sq: ['përshëndetje', 'botë', 'dhe', 'jetë', 'bukur', 'unë', 'janë', 'mirë', 'ditë'],
  su: ['jeung', 'kahirupan', 'éndah', 'abdi', 'anjeun', 'urang', 'hidep', 'sami', 'kumaha', 'sadayana'],
  sw: ['hujambo', 'maisha', 'mazuri', 'sana', 'habari', 'mzuri', 'safi', 'nzuri', 'jambo', 'karibu', 'asante'],
  uz: ['salom', 'dunyo', 'va', 'hayot', 'juda', 'chiroyli', 'qanday', 'yaxshi'],
  ne: ['नेपाल', 'काठमाडौं', 'हाम्रो', 'तपाईं', 'माया'],
  sr: ['zdravo', 'svijet', 'prijatelj', 'dobro', 'jutro', 'gdje', 'nek', 'šta'],
  mk: ['zdravo', 'svet', 'prijatel', 'dobar', 'den', 'dobro', 'jutro', 'što'],
  bg: ['zdrasti', 'svyat', 'priyatel', 'dobre', 'den', 'utro', 'kak'],
  uk: ['pryvit', 'svit', 'druh', 'dobry', 'den', 'ranok', 'yak'],
  kk: ['salem', 'älem', 'dos', 'jāqsy', 'kün', 'tań'],
  mn: ['sain', 'baina', 'delkhi', 'mongol', 'öröö'],
}
function isProbablyEnglish(text: string): boolean {
  return ENGLISH_DISTINCTIVE_RE.test(text)
}
function containsForeignWords(text: string, lang: string): boolean {
  const words = FOREIGN_WORDS[lang]
  if (!words) return false
  const lower = text.toLowerCase()
  return words.some(w => lower.includes(w.toLowerCase()))
}
function foreignWordScore(text: string, lang: string): number {
  const words = FOREIGN_WORDS[lang]
  if (!words) return 0
  const tokens = new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean))
  let score = 0
  for (const w of words) if (tokens.has(w.toLowerCase())) score += 1
  return score
}

function bestForeignLanguage(text: string): { lang: string | null; score: number } {
  let bestLang: string | null = null
  let bestScore = 0
  for (const lang of Object.keys(FOREIGN_WORDS)) {
    const score = foreignWordScore(text, lang)
    if (score > bestScore) {
      bestScore = score
      bestLang = lang
    }
  }
  return { lang: bestLang, score: bestScore }
}
function classifyCyrillic(text: string): string {
  if (/[ђћ]/.test(text)) return 'sr'
  if (/[ќѓ]/.test(text)) return 'mk'
  if (/[іїєґ]/.test(text)) return 'uk'
  if (/[әғқңөұһ]/.test(text)) return 'kk'
  if (/[ү]/.test(text)) return 'mn'
  if (/[ъѝ]/.test(text)) return 'bg'
  if (/[ыэё]/.test(text)) return 'ru'
  const c = franc(text, { minLength: 3 })
  const m = FRANC_TO_LANGUAGE[c]
  if (m && ['bg', 'mk', 'ru', 'sr', 'uk', 'kk', 'mn'].includes(m)) return m
  return 'ru'
}
function classifyArabic(text: string): string {
  if (/[ٹڈڑۓ]/.test(text)) return 'ur'
  if (/[ښځټڅې]/.test(text)) return 'ps'
  if (/[گچژپ]/.test(text)) return 'fa'
  return 'ar'
}
function detectTtsLanguage(text: string) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[嘅咗唔啲佢嗰哋畀]/.test(text)) return 'yue'
  if (HANGUL_RE.test(text)) return 'ko'
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)) return 'zh'
  if (THAI_RE.test(text)) return 'th'
  if (LAO_RE.test(text)) return 'lo'
  if (MYANMAR_RE.test(text)) return 'my'
  if (KHMER_RE.test(text)) return 'km'
  if (GEORGIAN_RE.test(text)) return 'ka'
  if (ETHIOPIC_RE.test(text)) return 'am'
  if (BENGALI_RE.test(text)) return 'bn'
  if (GUJARATI_RE.test(text)) return 'gu'
  if (TAMIL_RE.test(text)) return 'ta'
  if (TELUGU_RE.test(text)) return 'te'
  if (KANNADA_RE.test(text)) return 'kn'
  if (MALAYALAM_RE.test(text)) return 'ml'
  if (SINHALA_RE.test(text)) return 'si'
  if (GREEK_RE.test(text)) return 'el'
  if (HEBREW_RE.test(text)) return 'he'
  if (CANADIAN_ABORIGINAL_RE.test(text)) return 'iu'
  if (ARABIC_RE.test(text)) return classifyArabic(text)
  if (DEVANAGARI_RE.test(text)) {
    if (/[ळ]/.test(text)) return 'mr'
    if (text.trim().length >= 15) {
      const c = franc(text, { minLength: 3 })
      const m = FRANC_TO_LANGUAGE[c]
      if (m && ['hi', 'mr', 'ne'].includes(m)) return m
    }
    return 'hi'
  }
  if (/[\u0400-\u052f]/.test(text)) return classifyCyrillic(text)
  if (/[^\x00-\x7F]/.test(text)) {
    // Short ASCII name with CJK punctuation (e.g. "Ronny：") should remain English
    const asciiCore = text.replace(/[^\x00-\x7F]/g, '').trim()
    if (asciiCore && asciiCore.length < 10 && /^[A-Za-z0-9]+(?:[ \-_'][A-Za-z0-9]+)*$/.test(asciiCore)) {
      return 'en'
    }
    const { lang: bestLang, score: bestScore } = bestForeignLanguage(text)
    if (englishWordScore(text) > bestScore) return 'en'
    if (bestLang && bestScore > 0) return bestLang
    const c = franc(text, { minLength: 3 })
    const m = FRANC_TO_LANGUAGE[c]
    if (m && m !== 'en') return m
    return 'en'
  }
  if (isProbablyEnglish(text)) return 'en'
  {
    const { lang: bestLang, score: bestScore } = bestForeignLanguage(text)
    if (bestLang && bestScore > 0) return bestLang
  }
  if (text.trim().length < 10) return 'en'
  const c = franc(text, { minLength: 3 })
  const m = FRANC_TO_LANGUAGE[c]
  if (!m || m === 'en') return 'en'
  if (text.trim().length < 30) return 'en'
  return m
}

function minimumLength(lang: string) {
  return lang === 'en' ? 4 : 2
}

function splitTtsRuns(text: string) {
  const runs: { text: string; lang: string; start: number; end: number }[] = []
  let pendingWhitespace = ''
  let currentText = ''
  let currentCjk: boolean | null = null

  const flush = (endIndex: number) => {
    if (!currentText) return
    const start = endIndex - pendingWhitespace.length - currentText.length
    const lang = detectTtsLanguage(currentText)
    runs.push({ text: pendingWhitespace + currentText, lang, start, end: endIndex })
    pendingWhitespace = ''
    currentText = ''
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (/^\s$/.test(char)) {
      if (currentCjk === false) {
        currentText += char
      } else {
        flush(i)
        pendingWhitespace += char
      }
      continue
    }
    if (/\d/.test(char) && currentCjk !== null) {
      currentText += char
      continue
    }
    if (currentCjk && /[—─]/.test(char)) {
      currentText += char
      continue
    }
    if (currentCjk && (char === ',' || char === '.') && i + 1 < text.length && /\d/.test(text[i + 1])) {
      currentText += char
      continue
    }
    if (currentCjk !== null && currentText && PUNCT_KEEP_RE.test(char)) {
      currentText += char
      continue
    }
    const cjk = SEGMENT_CJK_RE.test(char)
    if (currentCjk === null || currentCjk === cjk) {
      currentCjk = cjk
      currentText += char
    } else {
      flush(i)
      currentCjk = cjk
      currentText = char
    }
  }
  flush(text.length)
  if (pendingWhitespace && runs.length > 0) {
    runs[runs.length - 1].text += pendingWhitespace
    runs[runs.length - 1].end = text.length
  }
  return runs
}

function mergeAdjacentRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  const merged: { text: string; lang: string; start: number; end: number }[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && last.lang === run.lang) {
      last.text += run.text
      last.end = run.end
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

function foldShortRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  const folded = [...runs]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < folded.length; i += 1) {
      const run = folded[i]
      const trimmed = run.text.trim()
      if (trimmed.length === 1 && SINGLE_CJK_RE.test(trimmed)) continue
      if (trimmed.length >= minimumLength(run.lang)) continue
      const prev = i > 0 ? folded[i - 1] : null
      const next = i < folded.length - 1 ? folded[i + 1] : null
      if (!prev && !next) continue
      const isPunctuationRun = PUNCT_ONLY_RE.test(trimmed)
      const target = isPunctuationRun
        ? prev
          ? i - 1
          : i + 1
        : !next || (prev && prev.text.length >= next.text.length)
          ? i - 1
          : i + 1
      if (target === i + 1) {
        folded[target].text = folded[i].text + folded[target].text
        folded[target].start = folded[i].start
      } else {
        folded[target].text += folded[i].text
        folded[target].end = folded[i].end
      }
      folded.splice(i, 1)
      changed = true
      break
    }
  }
  return mergeAdjacentRuns(folded)
}

function mergeBracketedCjkPrefixes(runs: { text: string; lang: string; start: number; end: number }[]) {
  const merged = [...runs]
  for (let i = 0; i < merged.length - 1; i += 1) {
    const current = merged[i]
    const next = merged[i + 1]
    if (current.lang === 'en' && next.lang !== 'en' && /^[\[(<{\u300c\u300e\u3010][\d\s]+$/.test(current.text.trimStart())) {
      next.text = current.text + next.text
      next.start = current.start
      merged.splice(i, 1)
      i -= 1
    }
  }
  return merged
}

function pushParagraph(
  run: { text: string; lang: string; start: number; end: number },
  startOffset: number,
  endOffset: number,
  out: { text: string; start: number; end: number }[],
) {
  const part = run.text.slice(startOffset, endOffset)
  const trimmed = part.trim()
  if (!trimmed) return
  const leading = part.length - part.trimStart().length
  const start = run.start + startOffset + leading
  out.push({ text: trimmed, start, end: start + trimmed.length })
}

function splitParagraphRanges(run: { text: string; lang: string; start: number; end: number }) {
  const out: { text: string; start: number; end: number }[] = []
  let last = 0
  const blankRe = /\n\s*\n/g
  let match: RegExpExecArray | null
  while ((match = blankRe.exec(run.text)) !== null) {
    pushParagraph(run, last, match.index, out)
    last = match.index + match[0].length
  }
  pushParagraph(run, last, run.text.length, out)
  return out
}

const CJK_SENTENCE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
function isCjkSentenceText(text: string): boolean {
  return CJK_SENTENCE_RE.test(text)
}

function splitIntoSentences(text: string) {
  const sentences: string[] = []
  let last = 0
  const isCjk = isCjkSentenceText(text)
  const termRe = isCjk
    ? /(?:[.!?。！？，、,;；:：]+\s*|[—─]{2,}\s*|\s+)/g
    : /[.!?。！？]+\s*/g
  let match: RegExpExecArray | null
  while ((match = termRe.exec(text)) !== null) {
    sentences.push(text.slice(last, match.index + match[0].length))
    last = match.index + match[0].length
  }
  if (last < text.length) sentences.push(text.slice(last))
  return sentences
}

function hardSplit(text: string, maxLength: number) {
  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLength))
    i += maxLength
  }
  return parts
}

function splitLongText(text: string, maxLength: number) {
  const sentences = splitIntoSentences(text)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      chunks.push(...hardSplit(sentence, maxLength))
      continue
    }
    if (current && current.length + sentence.length > maxLength) {
      chunks.push(current)
      current = sentence
    } else {
      current += sentence
    }
  }
  if (current) chunks.push(current)
  return chunks.filter(chunk => chunk.trim() !== '')
}

function cleanParagraph(paragraph: { text: string; start: number; end: number }, lang: string) {
  if (lang === 'en') {
    const offsets: number[] = []
    for (let i = 0; i < paragraph.text.length; i += 1) offsets.push(paragraph.start + i)
    return { text: paragraph.text, offsets }
  }
  const offsets: number[] = []
  let clean = ''
  let input = paragraph.start
  let i = 0
  while (i < paragraph.text.length) {
    const char = paragraph.text[i]
    if (char === '\r' && paragraph.text[i + 1] === '\n') {
      clean += ' '
      offsets.push(input)
      input += 2
      i += 2
      continue
    }
    if (char === '\n') {
      clean += ' '
      offsets.push(input)
      input += 1
      i += 1
      continue
    }
    clean += char
    offsets.push(input)
    input += 1
    i += 1
  }
  return { text: clean, offsets }
}

function refineEnglishRuns(runs: { text: string; lang: string; start: number; end: number }[]) {
  return runs.map(run => {
    if (run.lang === 'en' && run.text.trim().length >= 10) {
      const refined = detectTtsLanguage(run.text)
      if (refined !== run.lang) return { ...run, lang: refined }
    }
    return run
  })
}

export function splitTtsSegments(text: string, maxSegmentLength = MAX_SEGMENT_LENGTH): TtsSegment[] {
  const rawRuns = mergeBracketedCjkPrefixes(foldShortRuns(mergeAdjacentRuns(splitTtsRuns(text))))
  const runs = refineEnglishRuns(rawRuns)
  const segments: TtsSegment[] = []
  for (const run of runs) {
    for (const paragraph of splitParagraphRanges(run)) {
      const { text: clean, offsets } = cleanParagraph(paragraph, run.lang)
      if (clean.length === 0) continue
      if (clean.length <= maxSegmentLength) {
        segments.push({
          text: clean,
          lang: run.lang,
          indexStart: offsets[0],
          indexEnd: offsets[offsets.length - 1],
        })
        continue
      }
      const chunks = splitLongText(clean, maxSegmentLength)
      let searchFrom = 0
      for (const chunk of chunks) {
        const chunkStart = clean.indexOf(chunk, searchFrom)
        searchFrom = chunkStart + chunk.length
        const trimmed = chunk.trim()
        if (!trimmed) continue
        const trimmedStart = clean.indexOf(trimmed, chunkStart)
        const trimmedEnd = trimmedStart + trimmed.length
        segments.push({
          text: trimmed,
          lang: run.lang,
          indexStart: offsets[trimmedStart],
          indexEnd: offsets[trimmedEnd - 1],
        })
      }
    }
  }
  return segments
}

function splitSentenceRanges(text: string) {
  const sentences: { text: string; start: number; end: number }[] = []
  let last = 0
  const isCjk = isCjkSentenceText(text)
  const termRe = isCjk
    ? /(?:[.!?。！？，、,;；:：]+\s*|[—─]{2,}\s*|\s+)/g
    : /(?:[.!?。！？]+\s*|[—─]{2,}\s*)/g
  let match: RegExpExecArray | null
  while ((match = termRe.exec(text)) !== null) {
    const end = match.index + match[0].length
    sentences.push({ text: text.slice(last, end), start: last, end })
    last = end
  }
  if (last < text.length) {
    sentences.push({ text: text.slice(last), start: last, end: text.length })
  }
  return sentences
}

function mergeBracketRanges(ranges: HighlightRange[], text: string): HighlightRange[] {
  return mergeBracketRangesShared(ranges, text) as HighlightRange[]
}

export function splitHighlightRanges(text: string): HighlightRange[] {
  const ranges: HighlightRange[] = []
  for (const sentence of splitSentenceRanges(text)) {
    const rawRuns = mergeAdjacentRuns(splitTtsRuns(sentence.text))
    const runs = refineEnglishRuns(rawRuns)
    let prev: HighlightRange | null = null
    for (const run of runs) {
      const start = sentence.start + run.start
      const end = sentence.start + run.end
      if (prev && prev.lang === run.lang && prev.end === start) {
        prev.end = end
      } else {
        prev = { start, end, lang: run.lang }
        ranges.push(prev)
      }
    }
  }
  return mergeBracketRanges(ranges, text)
}

export function activeHighlightRange(
  ranges: HighlightRange[],
  boundaries: TtsBoundary[],
  time: number,
): HighlightRange | null {
  if (ranges.length === 0 || boundaries.length === 0) return null
  let offset = 0
  for (let i = 0; i < boundaries.length; i += 1) {
    if (boundaries[i].at <= time) offset = boundaries[i].offset
    else break
  }
  for (const range of ranges) {
    if (offset >= range.start && offset < range.end) return range
  }
  if (offset < ranges[0].start) return ranges[0]
  return ranges[ranges.length - 1]
}
