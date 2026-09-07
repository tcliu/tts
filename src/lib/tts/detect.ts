import { franc } from 'franc-min'

export const MAX_SEGMENT_LENGTH = 500
export const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/
export const SEGMENT_CJK_RE = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u3040-\u30ff\u0400-\u052f]/
export const SINGLE_CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u3130-\u318f]/
export const PUNCT_KEEP_RE = /[.!?。！？…·•\-—─，、,;；:：]/
export const PUNCT_ONLY_RE = /^[.!?。！？…·•\-—─，、,;；:：]+$/
export const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
export const DEVANAGARI_RE = /[\u0900-\u097F]/
export const BENGALI_RE = /[\u0980-\u09FF]/
export const GUJARATI_RE = /[\u0A80-\u0AFF]/
export const GURMUKHI_RE = /[\u0A00-\u0A7F]/
export const TAMIL_RE = /[\u0B80-\u0BFF]/
export const TELUGU_RE = /[\u0C00-\u0C7F]/
export const KANNADA_RE = /[\u0C80-\u0CFF]/
export const MALAYALAM_RE = /[\u0D00-\u0D7F]/
export const SINHALA_RE = /[\u0D80-\u0DFF]/
export const THAI_RE = /[\u0E00-\u0E7F]/
export const LAO_RE = /[\u0E80-\u0EFF]/
export const MYANMAR_RE = /[\u1000-\u109F]/
export const GEORGIAN_RE = /[\u10A0-\u10FF]/
export const ETHIOPIC_RE = /[\u1200-\u137F]/
export const CANADIAN_ABORIGINAL_RE = /[\u1400-\u167F]/
export const KHMER_RE = /[\u1780-\u17FF]/
export const GREEK_RE = /[\u0370-\u03FF]/
export const HEBREW_RE = /[\u0590-\u05FF]/
export const ARMENIAN_RE = /[\u0530-\u058F]/


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
// Lowercased once at module load so scoring a paragraph never re-lowercases
// the word lists; matching semantics are unchanged (tokens are lowercased).
const LOWER_FOREIGN_WORDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(FOREIGN_WORDS).map(([lang, words]) => [lang, words.map(word => word.toLowerCase())]),
)

function foreignWordScore(tokens: Set<string>, lang: string, minTokenLength = 3): number {
  const words = LOWER_FOREIGN_WORDS[lang]
  if (!words) return 0
  let score = 0
  for (const w of words) {
    if (w.length >= minTokenLength && tokens.has(w)) score += 1
  }
  return score
}

function bestForeignLanguage(text: string, minTokenLength = 3): { lang: string | null; score: number } {
  // Tokenize once: the previous per-language split re-ran toLowerCase plus a
  // unicode split for every language (~100x redundant work per paragraph).
  const tokens = new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean))
  let bestLang: string | null = null
  let bestScore = 0
  for (const lang of Object.keys(FOREIGN_WORDS)) {
    const score = foreignWordScore(tokens, lang, minTokenLength)
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
export function detectTtsLanguage(text: string) {
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
    // Short ASCII name whose only non-ASCII chars are CJK punctuation or
    // fullwidth forms (e.g. "Ronny：") should remain English; accented words
    // (e.g. "café") must still reach the foreign-language scoring below.
    const nonAscii = text.replace(/[\x00-\x7F]/g, '')
    const asciiCore = text.replace(/[^\x00-\x7F]/g, '').trim()
    if (
      asciiCore.length > 0 &&
      asciiCore.length < 10 &&
      /^[\u3000-\u303f\uff00-\uffef]+$/.test(nonAscii) &&
      /^[A-Za-z0-9]+(?:[ \-_'][A-Za-z0-9]+)*$/.test(asciiCore)
    ) {
      return 'en'
    }
    const englishScore = englishWordScore(text)
    // also ignore 1-2 letter tokens here so short Latin words can't hijack accented runs
    const { lang: bestLang, score: bestScore } = bestForeignLanguage(text, 3)
    if (englishScore > bestScore) return 'en'
    if (bestLang && bestScore > englishScore) return bestLang
    const c = franc(text, { minLength: 3 })
    const m = FRANC_TO_LANGUAGE[c]
    if (m && m !== 'en') return m
    return 'en'
  }
  if (isProbablyEnglish(text)) return 'en'
  {
    // Ignore 1-2 letter foreign tokens for ASCII text. They are too ambiguous
    // across Latin-script languages (e.g. French "le") and otherwise hijack
    // English-heavy runs and word-level highlight ranges.
    const englishScore = englishWordScore(text)
    const { lang: bestLang, score: bestScore } = bestForeignLanguage(text, 3)
    if (bestLang && bestScore > englishScore) return bestLang
  }
  if (text.trim().length < 10) return 'en'
  const c = franc(text, { minLength: 3 })
  const m = FRANC_TO_LANGUAGE[c]
  if (!m || m === 'en') return 'en'
  if (text.trim().length < 30) return 'en'
  return m
}

export function minimumLength(lang: string) {
  return lang === 'en' ? 4 : 2
}
