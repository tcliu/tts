#!/usr/bin/env node

import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));


const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_CHROMIUM = '143.0.3650.75';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
const HISTORY_LIMIT = 50;
const TTS_DIR = path.resolve('.tts');
const HISTORY_PATH = path.join(TTS_DIR, 'history.json');
const CACHE_DIR = path.join(TTS_DIR, 'cache');
const CACHE_INDEX_PATH = path.join(CACHE_DIR, 'index.json');
const CACHE_MAX = Number(process.env.TTS_CACHE_MAX) > 0 ? Number(process.env.TTS_CACHE_MAX) : 1000;
const SELECTION_PATH = path.join(TTS_DIR, 'selection.json');
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  reverse: '\x1b[7m',
  bgCyan: '\x1b[46m',
  black: '\x1b[30m',
};

const LANGUAGES = [
  {
    code: 'en',
    name: 'English',
    voices: [
      { name: 'Sonia', gender: 'Female', source: 'edge', edge: 'en-GB-SoniaNeural', group: 'British' },
      { name: 'Ryan', gender: 'Male', source: 'edge', edge: 'en-GB-RyanNeural', group: 'British' },
      { name: 'Libby', gender: 'Female', source: 'edge', edge: 'en-GB-LibbyNeural', group: 'British' },
      { name: 'Maisie', gender: 'Female', source: 'edge', edge: 'en-GB-MaisieNeural', group: 'British' },
      { name: 'Alfie', gender: 'Male', source: 'edge', edge: 'en-GB-AlfieNeural', group: 'British' },
      { name: 'Aria', gender: 'Female', source: 'edge', edge: 'en-US-AriaNeural', group: 'American' },
      { name: 'Jenny', gender: 'Female', source: 'edge', edge: 'en-US-JennyNeural', group: 'American' },
      { name: 'Guy', gender: 'Male', source: 'edge', edge: 'en-US-GuyNeural', group: 'American' },
      { name: 'Michelle', gender: 'Female', source: 'edge', edge: 'en-US-MichelleNeural', group: 'American' },
      { name: 'Ana', gender: 'Female', source: 'edge', edge: 'en-US-AnaNeural', group: 'American' },
      { name: 'Natasha', gender: 'Female', source: 'edge', edge: 'en-AU-NatashaNeural', group: 'Australian' },
      { name: 'William', gender: 'Male', source: 'edge', edge: 'en-AU-WilliamNeural', group: 'Australian' },
      { name: 'Clara', gender: 'Female', source: 'edge', edge: 'en-CA-ClaraNeural', group: 'Canadian' },
      { name: 'Liam', gender: 'Male', source: 'edge', edge: 'en-CA-LiamNeural', group: 'Canadian' },
      { name: 'Neerja', gender: 'Female', source: 'edge', edge: 'en-IN-NeerjaNeural', group: 'Indian' },
      { name: 'Prabhat', gender: 'Male', source: 'edge', edge: 'en-IN-PrabhatNeural', group: 'Indian' },
    ],
  },
  {
    code: 'zh',
    name: 'Chinese',
    voices: [
      { name: 'Xiaoxiao', gender: 'Female', source: 'edge', edge: 'zh-CN-XiaoxiaoNeural', group: 'Mandarin' },
      { name: 'Xiaoyi', gender: 'Female', source: 'edge', edge: 'zh-CN-XiaoyiNeural', group: 'Mandarin' },
      { name: 'Yunxi', gender: 'Male', source: 'edge', edge: 'zh-CN-YunxiNeural', group: 'Mandarin' },
      { name: 'Yunyang', gender: 'Male', source: 'edge', edge: 'zh-CN-YunyangNeural', group: 'Mandarin' },
      { name: 'HiuGaai', gender: 'Female', source: 'edge', edge: 'zh-HK-HiuGaaiNeural', group: 'Cantonese' },
      { name: 'HiuMaan', gender: 'Female', source: 'edge', edge: 'zh-HK-HiuMaanNeural', group: 'Cantonese' },
      { name: 'WanLung', gender: 'Male', source: 'edge', edge: 'zh-HK-WanLungNeural', group: 'Cantonese' },
      { name: 'HsiaoChen', gender: 'Female', source: 'edge', edge: 'zh-TW-HsiaoChenNeural', group: 'Taiwan' },
      { name: 'HsiaoYu', gender: 'Female', source: 'edge', edge: 'zh-TW-HsiaoYuNeural', group: 'Taiwan' },
      { name: 'YunJhe', gender: 'Male', source: 'edge', edge: 'zh-TW-YunJheNeural', group: 'Taiwan' },
    ],
  },
  {
    code: 'ja',
    name: 'Japanese',
    voices: [
      { name: 'Nanami', gender: 'Female', source: 'edge', edge: 'ja-JP-NanamiNeural' },
      { name: 'Keita', gender: 'Male', source: 'edge', edge: 'ja-JP-KeitaNeural' },
    ],
  },
  {
    code: 'ko',
    name: 'Korean',
    voices: [
      { name: 'SunHi', gender: 'Female', source: 'edge', edge: 'ko-KR-SunHiNeural' },
      { name: 'InJoon', gender: 'Male', source: 'edge', edge: 'ko-KR-InJoonNeural' },
    ],
  },
  {
    code: 'es',
    name: 'Spanish',
    voices: [
      { name: 'Elvira', gender: 'Female', source: 'edge', edge: 'es-ES-ElviraNeural', group: 'Spain' },
      { name: 'Alvaro', gender: 'Male', source: 'edge', edge: 'es-ES-AlvaroNeural', group: 'Spain' },
      { name: 'Dalia', gender: 'Female', source: 'edge', edge: 'es-MX-DaliaNeural', group: 'Mexico' },
      { name: 'Jorge', gender: 'Male', source: 'edge', edge: 'es-MX-JorgeNeural', group: 'Mexico' },
    ],
  },
  {
    code: 'fr',
    name: 'French',
    voices: [
      { name: 'Denise', gender: 'Female', source: 'edge', edge: 'fr-FR-DeniseNeural', group: 'France' },
      { name: 'Henri', gender: 'Male', source: 'edge', edge: 'fr-FR-HenriNeural', group: 'France' },
      { name: 'Vivienne', gender: 'Female', source: 'edge', edge: 'fr-FR-VivienneNeural', group: 'France' },
      { name: 'Sylvie', gender: 'Female', source: 'edge', edge: 'fr-CA-SylvieNeural', group: 'Canada' },
      { name: 'Jean', gender: 'Male', source: 'edge', edge: 'fr-CA-JeanNeural', group: 'Canada' },
      { name: 'Charline', gender: 'Female', source: 'edge', edge: 'fr-BE-CharlineNeural', group: 'Belgium' },
      { name: 'Gerard', gender: 'Male', source: 'edge', edge: 'fr-BE-GerardNeural', group: 'Belgium' },
    ],
  },
  {
    code: 'ru',
    name: 'Russian',
    voices: [
      { name: 'Svetlana', gender: 'Female', source: 'edge', edge: 'ru-RU-SvetlanaNeural' },
      { name: 'Dmitry', gender: 'Male', source: 'edge', edge: 'ru-RU-DmitryNeural' },
      { name: 'Dariya', gender: 'Female', source: 'edge', edge: 'ru-RU-DariyaNeural' },
    ],
  },
];

const MODES = [
  { id: 'play', label: 'Play' },
  { id: 'save', label: 'Save' },
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

function edgeSecMsGecToken() {
  const ticks = BigInt(Math.floor(Date.now() / 1000 + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
  const roundedTicks = ticks - (ticks % 3000000000n);
  return createHash('sha256').update(`${roundedTicks}${EDGE_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---- Text segmentation (ported from share-text/src/lib/tts-language.ts) ----
const MAX_SEGMENT_LENGTH = 500;

const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/;
const SEGMENT_CJK_RE = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u3040-\u30ff\u0400-\u052f]/;
const SINGLE_CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u3130-\u318f]/;
const PUNCT_KEEP_RE = /[.!?。！？…·•\-—─]/;
const PUNCT_ONLY_RE = /^[.!?。！？…·•\-—─]+$/;

function detectTtsLanguage(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[嘅咗唔啲佢嗰哋畀]/.test(text)) return 'yue';
  if (HANGUL_RE.test(text)) return 'ko';
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(text)) return 'zh';
  if (/[\u0400-\u052f]/.test(text)) return 'ru';
  if (/[ñÑ¿¡]/.test(text)) return 'es';
  if (/[çÇœŒæÆàÀèÈêÊîÎôÔûÛùÙâÂ]/.test(text)) return 'fr';
  return 'en';
}

function minimumLength(lang) {
  return lang === 'en' ? 4 : 2;
}

function splitTtsRuns(text) {
  const runs = [];
  let pendingWhitespace = '';
  let currentText = '';
  let currentCjk = null;

  const flush = (endIndex) => {
    if (!currentText) return;
    const start = endIndex - pendingWhitespace.length - currentText.length;
    const lang = detectTtsLanguage(currentText);
    runs.push({ text: pendingWhitespace + currentText, lang, start, end: endIndex });
    pendingWhitespace = '';
    currentText = '';
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/^\s$/.test(char)) {
      flush(i);
      pendingWhitespace += char;
      continue;
    }
    if (/\d/.test(char) && currentCjk !== null) {
      currentText += char;
      continue;
    }
    if (currentCjk && (char === ',' || char === '.') && i + 1 < text.length && /\d/.test(text[i + 1])) {
      currentText += char;
      continue;
    }
    if (currentCjk !== null && currentText && PUNCT_KEEP_RE.test(char)) {
      currentText += char;
      continue;
    }
    const cjk = SEGMENT_CJK_RE.test(char);
    if (currentCjk === null || currentCjk === cjk) {
      currentCjk = cjk;
      currentText += char;
    } else {
      flush(i);
      currentCjk = cjk;
      currentText = char;
    }
  }
  flush(text.length);
  if (pendingWhitespace && runs.length > 0) {
    runs[runs.length - 1].text += pendingWhitespace;
    runs[runs.length - 1].end = text.length;
  }
  return runs;
}

function mergeAdjacentRuns(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.lang === run.lang) {
      last.text += run.text;
      last.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function foldShortRuns(runs) {
  const folded = [...runs];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < folded.length; i++) {
      const run = folded[i];
      const trimmed = run.text.trim();
      if (trimmed.length === 1 && SINGLE_CJK_RE.test(trimmed)) continue;
      if (trimmed.length >= minimumLength(run.lang)) continue;
      const prev = i > 0 ? folded[i - 1] : null;
      const next = i < folded.length - 1 ? folded[i + 1] : null;
      if (!prev && !next) continue;
      const isPunctuationRun = PUNCT_ONLY_RE.test(trimmed);
      const target = isPunctuationRun
        ? prev
          ? i - 1
          : i + 1
        : !next || (prev && prev.text.length >= next.text.length)
          ? i - 1
          : i + 1;
      if (target === i + 1) {
        folded[target].text = folded[i].text + folded[target].text;
        folded[target].start = folded[i].start;
      } else {
        folded[target].text += folded[i].text;
        folded[target].end = folded[i].end;
      }
      folded.splice(i, 1);
      changed = true;
      break;
    }
  }
  return mergeAdjacentRuns(folded);
}

function mergeBracketedCjkPrefixes(runs) {
  const merged = [...runs];
  for (let i = 0; i < merged.length - 1; i++) {
    const current = merged[i];
    const next = merged[i + 1];
    if (
      current.lang === 'en' &&
      next.lang !== 'en' &&
      /^[\[(<{\u300c\u300e\u3010][\d\s]+$/.test(current.text.trimStart())
    ) {
      next.text = current.text + next.text;
      next.start = current.start;
      merged.splice(i, 1);
      i -= 1;
    }
  }
  return merged;
}

function pushParagraph(run, startOffset, endOffset, out) {
  const part = run.text.slice(startOffset, endOffset);
  const trimmed = part.trim();
  if (!trimmed) return;
  const leading = part.length - part.trimStart().length;
  const start = run.start + startOffset + leading;
  out.push({ text: trimmed, start, end: start + trimmed.length });
}

function splitParagraphRanges(run) {
  const out = [];
  let last = 0;
  const blankRe = /\n\s*\n/g;
  let match;
  while ((match = blankRe.exec(run.text)) !== null) {
    pushParagraph(run, last, match.index, out);
    last = match.index + match[0].length;
  }
  pushParagraph(run, last, run.text.length, out);
  return out;
}

function splitIntoSentences(text) {
  const sentences = [];
  let last = 0;
  const termRe = /[.!?。！？]+\s*/g;
  let match;
  while ((match = termRe.exec(text)) !== null) {
    sentences.push(text.slice(last, match.index + match[0].length));
    last = match.index + match[0].length;
  }
  if (last < text.length) sentences.push(text.slice(last));
  return sentences;
}

function hardSplit(text, maxLength) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLength));
    i += maxLength;
  }
  return parts;
}

function splitLongText(text, maxLength) {
  const sentences = splitIntoSentences(text);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...hardSplit(sentence, maxLength));
      continue;
    }
    if (current && current.length + sentence.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.trim() !== '');
}

function cleanParagraph(paragraph, lang) {
  if (lang === 'en') {
    const offsets = [];
    for (let i = 0; i < paragraph.text.length; i++) offsets.push(paragraph.start + i);
    return { text: paragraph.text, offsets };
  }
  const offsets = [];
  let clean = '';
  let input = paragraph.start;
  let i = 0;
  while (i < paragraph.text.length) {
    const char = paragraph.text[i];
    if (char === '\r' && paragraph.text[i + 1] === '\n') {
      input += 2;
      i += 2;
      continue;
    }
    if (char === '\n') {
      input += 1;
      i += 1;
      continue;
    }
    clean += char;
    offsets.push(input);
    input += 1;
    i += 1;
  }
  return { text: clean, offsets };
}

function splitTtsSegments(text, maxSegmentLength = MAX_SEGMENT_LENGTH) {
  const runs = mergeBracketedCjkPrefixes(foldShortRuns(mergeAdjacentRuns(splitTtsRuns(text))));
  const segments = [];
  for (const run of runs) {
    for (const paragraph of splitParagraphRanges(run)) {
      const { text: clean, offsets } = cleanParagraph(paragraph, run.lang);
      if (clean.length === 0) continue;
      if (clean.length <= maxSegmentLength) {
        segments.push({
          text: clean,
          lang: run.lang,
          indexStart: offsets[0],
          indexEnd: offsets[offsets.length - 1],
        });
        continue;
      }
      const chunks = splitLongText(clean, maxSegmentLength);
      let searchFrom = 0;
      for (const chunk of chunks) {
        const chunkStart = clean.indexOf(chunk, searchFrom);
        searchFrom = chunkStart + chunk.length;
        const trimmed = chunk.trim();
        if (!trimmed) continue;
        const trimmedStart = clean.indexOf(trimmed, chunkStart);
        const trimmedEnd = trimmedStart + trimmed.length;
        segments.push({
          text: trimmed,
          lang: run.lang,
          indexStart: offsets[trimmedStart],
          indexEnd: offsets[trimmedEnd - 1],
        });
      }
    }
  }
  return segments;
}

function displayWidth(s) {
  let w = 0;
  let inEsc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inEsc) {
      if (ch === 'm') inEsc = false;
      continue;
    }
    if (ch === '\x1b') {
      inEsc = true;
      continue;
    }
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}

function padRight(s, width) {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

function wrapText(text, width) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (displayWidth(trial) > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const HELP_TEXT = 'Tab: menu · ←/→: tab/pane · ↑/↓: option/group · Shift+Arrows: select · Mouse: click=move, drag=select, click menu · Ctrl+A: all · Enter: newline · Alt+Enter: speak · Ctrl+K: clear · Esc: stop · PgUp/PgDn: history · Ctrl+C: quit';

function helpLineCount() {
  const cols = Math.max(60, stdout.columns || 80);
  return wrapText(HELP_TEXT, cols).slice(0, 3).length;
}

function progressBar(fraction, width) {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return `${c.cyan}${'█'.repeat(filled)}${c.gray}${'░'.repeat(Math.max(0, width - filled))}${c.reset}`;
}

function truncate(s, width) {
  let w = 0;
  let out = '';
  let inEsc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inEsc) {
      out += ch;
      if (ch === 'm') inEsc = false;
      continue;
    }
    if (ch === '\x1b') {
      out += ch;
      inEsc = true;
      continue;
    }
    const cw = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
    if (w + cw > width) break;
    w += cw;
    out += ch;
  }
  return out;
}

function edgeSynthesize(text, edgeVoice) {
  const url =
    'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
    `?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${edgeSecMsGecToken()}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM}` +
    `&ConnectionId=${randomUUID().replaceAll('-', '')}`;
  const ws = new WebSocket(url, {
    headers: { 'User-Agent': USER_AGENT, 'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold' },
  });

  return new Promise((resolve, reject) => {
    const audio = [];
    let closed = false;

    ws.addEventListener('open', () => {
      const config = JSON.stringify({
        context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        } } },
      });
      ws.send(`X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}`);
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${edgeVoice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>` +
        `${escapeXml(text)}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${randomUUID().replaceAll('-', '')}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.addEventListener('message', async (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('turn.end')) {
          closed = true;
          ws.close();
          resolve(Buffer.concat(audio));
        }
        return;
      }
      const data = Buffer.from(await event.data.arrayBuffer());
      const separator = Buffer.from('Path:audio\r\n');
      const index = data.indexOf(separator);
      audio.push(data.subarray(index + separator.length));
    });

    ws.addEventListener('error', (e) => {
      if (!closed) reject(new Error(e.message || 'Edge WebSocket error'));
    });
    ws.addEventListener('close', (e) => {
      if (!closed && audio.length === 0 && e.code !== 1000) {
        reject(new Error(`Edge WebSocket closed with code ${e.code}`));
      }
    });
  });
}

const errMsg = (e) => (e instanceof Error ? e.message : String(e));

function providerAvailable() {
  return true;
}

async function synthesize(text, lang, voice, opts = {}) {
  const key = cacheKey(text, voice);
  const cached = await readCache(key);
  if (cached) return { buffer: cached, engine: voice.source, voice, cached: true };
  const buffer = await edgeSynthesize(text, voice.edge);
  await writeCache(key, voice.source, buffer);
  return { buffer, engine: voice.source, voice };
}

function playBuffer(buffer) {
  if (state.stopRequested) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const args = ['-nodisp', '-autoexit'];
    if (state.speed !== 1) args.push('-af', `atempo=${state.speed}`);
    args.push('-i', 'pipe:0');
    const player = spawn('ffplay', args, {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    state.player = player;
    player.stdin.on('error', () => {});
    player.stdin.write(buffer);
    player.stdin.end();
    player.on('error', (err) => {
      state.player = null;
      reject(new Error(`ffplay not found: ${err.message} — install ffmpeg (sudo apt install ffmpeg)`));
    });
    player.on('close', (code) => {
      state.player = null;
      if (code === 0 || state.stopRequested) resolve();
      else reject(new Error(`Player exited with code ${code}`));
    });
  });
}

function stopPlayback() {
  state.stopRequested = true;
  if (state.player) {
    try { state.player.kill('SIGKILL'); } catch {}
    state.player = null;
  }
  clearSegmentTimer();
  state.busy = false;
  state.status = `${c.yellow}Stopped.${c.reset}`;
  redraw();
}

let segTimer = null;

function clearSegmentTimer() {
  if (segTimer) {
    clearInterval(segTimer);
    segTimer = null;
  }
}

function fmtSec(sec) {
  const t = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function getAudioDuration(buffer, source) {
  const ext = 'mp3';
  const tmp = path.join('/tmp', `dur-${randomUUID()}.${ext}`);
  return writeFile(tmp, buffer)
    .then(() => new Promise((resolve) => {
      const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', tmp], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('close', () => {
        const t = parseFloat(out.trim());
        resolve(Number.isFinite(t) ? t : null);
      });
    }))
    .catch(() => null)
    .finally(() => unlink(tmp).catch(() => {}));
}

function speakStatus(i, n, segLang, voice, engine, elapsed, total) {
  const model = truncate(`${voice.name} [${voice.source}]`, 24);
  const timer = total ? `${fmtSec(elapsed)}/${fmtSec(total)}` : `⏱ ${fmtSec(elapsed)}`;
  return `${c.yellow}Speaking${c.reset} ${progressBar((i + 1) / n, 10)} ${i + 1}/${n} ${c.gray}· ${segLang.name} · ${model} · ${timer}${c.reset}`;
}

function playSegmentWithTimer(i, n, segLang, voice, engine, buffer) {
  const start = Date.now();
  let total = null;
  getAudioDuration(buffer, voice.source).then((t) => {
    total = t;
    state.status = speakStatus(i, n, segLang, voice, engine, (Date.now() - start) / 1000, total);
    draw();
  });
  const build = () => speakStatus(i, n, segLang, voice, engine, (Date.now() - start) / 1000, total);
  state.status = build();
  draw();
  clearSegmentTimer();
  segTimer = setInterval(() => {
    state.status = build();
    draw();
  }, 500);
  return playBuffer(buffer).finally(() => clearSegmentTimer());
}

const state = {
  voiceByLang: {},
  input: [],
  caret: 0,
  anchor: 0,
  mode: 'play',
  status: `${c.green}Ready.${c.reset} Tab: menu · Alt+Enter: speak.`,
  spoken: 0,
  saveSeq: 0,
  busy: false,
  history: [],
  historyIndex: -1,
  menuCursor: 0,
  menuOpen: false,
  menuGroup: 0,
  menuPane: 'right',
  speed: 1,
  player: null,
  stopRequested: false,
  boxWidth: 120,
  segments: [],
  segIndex: -1,
  hlRange: null,
  lastLines: null,
  fullClear: true,
  mouseSelecting: false,
};

const LANG_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

function langOf(code) {
  const c = code === 'yue' ? 'zh' : code;
  return LANG_BY_CODE[c] || LANGUAGES[0];
}

function voiceForLang(code) {
  const lang = langOf(code);
  const key = code === 'yue' ? 'zh' : code;
  const idx = state.voiceByLang[key] ?? 0;
  return lang.voices[Math.min(idx, lang.voices.length - 1)];
}

function menuTabCount() {
  return LANGUAGES.length + 2;
}

function menuTabNames() {
  return [...LANGUAGES.map((l) => l.name), 'Mode', 'Speed'];
}

function menuTabLang() {
  return LANGUAGES[state.menuCursor] || null;
}

function menuTabKind() {
  if (state.menuCursor < LANGUAGES.length) return 'lang';
  return state.menuCursor === LANGUAGES.length ? 'mode' : 'speed';
}

function voiceGroup(voice) {
  return voice.group || 'Default';
}

function groupsOf(lang) {
  const seen = [];
  for (const v of lang.voices) {
    const g = voiceGroup(v);
    if (!seen.includes(g)) seen.push(g);
  }
  return seen.length ? seen : ['Default'];
}

function visibleGroupVoices(lang) {
  const groups = groupsOf(lang);
  const group = groups[Math.min(state.menuGroup, groups.length - 1)];
  return lang.voices.filter((v) => voiceGroup(v) === group);
}

function hasMenuPanes() {
  const lang = menuTabLang();
  return !!lang && groupsOf(lang).length >= 2;
}

function moveMenuGroup(delta) {
  const lang = menuTabLang();
  if (!lang) return;
  const groups = groupsOf(lang);
  const next = (state.menuGroup + delta + groups.length) % groups.length;
  state.menuGroup = next;
  const groupVoices = visibleGroupVoices(lang);
  const cur = state.voiceByLang[lang.code] ?? 0;
  if (!groupVoices.some((v) => lang.voices.indexOf(v) === cur)) {
    state.voiceByLang[lang.code] = lang.voices.indexOf(groupVoices[0]);
  }
  state.status = `${c.green}Group:${c.reset} ${groups[next]}`;
  saveSelection();
  redraw();
}

function moveMenuVertical(delta) {
  if (hasMenuPanes() && state.menuPane === 'left') moveMenuGroup(delta);
  else moveMenuSelection(delta);
}

function moveMenuHorizontal(delta) {
  if (hasMenuPanes()) {
    if (delta > 0 && state.menuPane === 'left') { state.menuPane = 'right'; redraw(); return; }
    if (delta < 0 && state.menuPane === 'right') { state.menuPane = 'left'; redraw(); return; }
  }
  moveMenuTab(delta);
}

const CJK_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

function cjkWidth(ch) {
  return CJK_RE.test(ch) ? 2 : 1;
}

function contentWidth() {
  return Math.max(1, state.boxWidth - 4);
}

function visualRows() {
  const width = contentWidth();
  const rows = [];
  let start = 0;
  let w = 0;
  let wordStart = 0;
  for (let i = 0; i < state.input.length; i++) {
    const ch = state.input[i];
    if (ch === '\n') {
      rows.push({ start, end: i });
      start = i + 1;
      w = 0;
      wordStart = start;
      continue;
    }
    const cw = cjkWidth(ch);
    if (w + cw > width) {
      if (wordStart > start) {
        rows.push({ start, end: wordStart });
        let carried = 0;
        for (let k = wordStart; k < i; k++) carried += cjkWidth(state.input[k]);
        start = wordStart;
        w = carried;
      } else {
        rows.push({ start, end: i });
        start = i;
        w = 0;
      }
    }
    if (ch === ' ' || ch === '\t') wordStart = i + 1;
    w += cw;
  }
  rows.push({ start, end: state.input.length });
  return rows;
}

function lineCount() {
  return visualRows().length;
}

function rowOfOffset(off) {
  const rows = visualRows();
  const clamped = Math.max(0, Math.min(off, state.input.length));
  for (let r = 0; r < rows.length; r++) {
    if (clamped >= rows[r].start && clamped <= rows[r].end) return r;
  }
  return rows.length - 1;
}

function caretLine() {
  return rowOfOffset(state.caret);
}

function lineStart(line) {
  return visualRows()[line].start;
}

function lineEnd(line) {
  return visualRows()[line].end;
}

function moveVertical(delta) {
  const rows = visualRows();
  const line = caretLine();
  const col = state.caret - rows[line].start;
  const target = line + delta;
  if (target < 0 || target >= rows.length) return;
  state.caret = Math.min(rows[target].start + col, rows[target].end);
}

function breakHistory() {
  if (state.historyIndex !== -1) {
    state.historyIndex = -1;
    state.status = `${c.green}Editing.${c.reset} Enter = newline, Alt+Enter = speak.`;
  }
}

function selectionRange() {
  const a = Math.min(state.anchor, state.caret);
  const b = Math.max(state.anchor, state.caret);
  return a !== b ? [a, b] : null;
}

function clearSegSelection() {
  if (state.segments.length > 0 || state.segIndex !== -1 || state.hlRange) {
    state.segments = [];
    state.segIndex = -1;
    state.hlRange = null;
  }
}

function deleteSelection() {
  const r = selectionRange();
  if (!r) return false;
  state.input.splice(r[0], r[1] - r[0]);
  state.caret = r[0];
  state.anchor = r[0];
  return true;
}

function backspace() {
  if (deleteSelection()) return;
  if (state.caret === 0) return;
  state.input.splice(state.caret - 1, 1);
  state.caret -= 1;
  state.anchor = state.caret;
}

function deleteForward() {
  if (deleteSelection()) return;
  if (state.caret >= state.input.length) return;
  state.input.splice(state.caret, 1);
  state.anchor = state.caret;
}

function focusMenuItem(index) {
  state.menuCursor = index;
  state.menuOpen = true;
  redraw();
}

function voiceLabel(voice) {
  return `${voice.name} ${c.gray}(${voice.edge}) [edge]${c.reset}`;
}

function moveMenuTab(delta) {
  const n = menuTabCount();
  state.menuCursor = (state.menuCursor + delta + n) % n;
  state.menuGroup = 0;
  state.menuPane = 'right';
  const tabName = menuTabNames()[state.menuCursor];
  state.status = `${c.green}Tab:${c.reset} ${tabName}`;
  saveSelection();
  redraw();
}

function moveMenuSelection(delta) {
  const lang = menuTabLang();
  if (lang) {
    const groupVoices = visibleGroupVoices(lang);
    const cur = state.voiceByLang[lang.code] ?? 0;
    let pos = groupVoices.findIndex((v) => lang.voices.indexOf(v) === cur);
    if (pos === -1) pos = 0;
    pos = (pos + delta + groupVoices.length) % groupVoices.length;
    state.voiceByLang[lang.code] = lang.voices.indexOf(groupVoices[pos]);
    if (state.busy) voiceChanged = true;
    const voice = lang.voices[state.voiceByLang[lang.code]];
    const hint = '';
    state.status = `${c.green}Voice:${c.reset} ${lang.name} → ${voiceLabel(voice)}${hint}`;
  } else if (menuTabKind() === 'speed') {
    const cur = SPEEDS.indexOf(state.speed);
    const next = (cur + delta + SPEEDS.length) % SPEEDS.length;
    state.speed = SPEEDS[next];
    state.status = `${c.green}Speed:${c.reset} ${state.speed}×`;
  } else {
    const next = (MODES.findIndex((m) => m.id === state.mode) + delta + MODES.length) % MODES.length;
    state.mode = MODES[next].id;
    state.status = `${c.green}Mode:${c.reset} ${state.mode === 'play' ? 'play audio' : 'save audio'}`;
  }
  saveSelection();
  redraw();
}

function historyPageUp() {
  if (state.history.length === 0) return;
  if (state.historyIndex === -1) {
    state.historyIndex = state.history.length - 1;
  } else if (state.historyIndex > 0) {
    state.historyIndex -= 1;
  } else {
    return;
  }
  state.input = Array.from(state.history[state.historyIndex]);
  state.caret = state.input.length;
  state.anchor = state.caret;
  clearSegSelection();
  state.status = `${c.dim}History ${state.history.length - state.historyIndex}/${state.history.length}${c.reset}`;
  redraw();
}

function historyPageDown() {
  if (state.historyIndex === -1) return;
  state.historyIndex += 1;
  if (state.historyIndex >= state.history.length) {
    state.historyIndex = -1;
    state.input = [];
    state.caret = 0;
    state.anchor = 0;
    state.status = `${c.green}Editing.${c.reset} Enter = newline, Alt+Enter = speak.`;
  } else {
    state.input = Array.from(state.history[state.historyIndex]);
    state.caret = state.input.length;
    state.anchor = state.caret;
    clearSegSelection();
    state.status = `${c.dim}History ${state.history.length - state.historyIndex}/${state.history.length}${c.reset}`;
  }
  redraw();
}

function tabOptions() {
  const lang = menuTabLang();
  if (lang) {
    const groupVoices = visibleGroupVoices(lang);
    const cur = state.voiceByLang[lang.code] ?? 0;
    const pos = groupVoices.findIndex((v) => lang.voices.indexOf(v) === cur);
    return { options: groupVoices.map((v) => voiceLabel(v)), selected: pos === -1 ? 0 : pos };
  }
  if (menuTabKind() === 'speed') {
    return { options: SPEEDS.map((x) => `${x}×`), selected: SPEEDS.indexOf(state.speed) };
  }
  return { options: MODES.map((m) => m.label), selected: state.mode === 'play' ? 0 : 1 };
}

function buildDialog(width, listH) {
  const inner = width - 2;
  const content = inner - 2;
  const tabs = menuTabNames();
  const tabParts = tabs.map((t, i) => {
    if (i === state.menuCursor) return `${c.cyan}${c.bold}${c.reverse}${t}${c.reset}`;
    return `${c.gray}${t}${c.reset}`;
  });
  const tabLine = `Tabs:  ${tabParts.join('  ')}`;

  const border = (s) => `${c.cyan}${s}${c.reset}`;
  const dashes = Math.max(1, inner - 6);
  const side = (innerText) => `${c.cyan}│${c.reset} ${innerText}${c.cyan} │${c.reset}`;
  const out = [
    border(`┌ MENU ${'─'.repeat(dashes)}┐`),
    side(padRight(truncate(tabLine, content), content)),
    side('─'.repeat(content)),
  ];

  const { options, selected } = tabOptions();
  if (!hasMenuPanes()) {
    let start = 0;
    if (options.length > listH) {
      start = Math.max(0, Math.min(selected - Math.floor(listH / 2), options.length - listH));
    }
    const listLines = [];
    for (let i = 0; i < listH; i++) {
      const idx = start + i;
      if (idx >= options.length) {
        listLines.push('');
        continue;
      }
      const isSel = idx === selected;
      const marker = isSel ? `${c.cyan}▸${c.reset} ` : '  ';
      let label = options[idx];
      if (isSel) label = `${c.bold}${c.reverse}${label}${c.reset}`;
      let line = `${marker}${label}`;
      if (i === 0 && start > 0) line += ` ${c.dim}▲${c.reset}`;
      if (i === listH - 1 && start + listH < options.length) line += ` ${c.dim}▼${c.reset}`;
      listLines.push(line);
    }
    for (const l of listLines) out.push(side(padRight(truncate(l, content), content)));
    out.push(border(`└${'─'.repeat(inner)}┘`));
    return out;
  }

  const lang = menuTabLang();
  const groups = groupsOf(lang);
  const pw = Math.max(9, Math.min(14, Math.max(...groups.map((g) => g.length)) + 3));
  const rw = content - pw - 1;
  let start = 0;
  if (options.length > listH) {
    start = Math.max(0, Math.min(selected - Math.floor(listH / 2), options.length - listH));
  }
  for (let i = 0; i < listH; i++) {
    let left;
    const gi = i;
    if (gi < groups.length) {
      const g = groups[gi];
      const isGroup = gi === state.menuGroup;
      if (isGroup) {
        if (state.menuPane === 'left') left = `${c.cyan}${c.bold}${c.reverse}▸ ${g}${c.reset}`;
        else left = `${c.cyan}▸${c.reset} ${c.bold}${g}${c.reset}`;
      } else {
        left = `  ${c.gray}${g}${c.reset}`;
      }
      left = padRight(truncate(left, pw), pw);
    } else {
      left = ' '.repeat(pw);
    }
    let right;
    const idx = start + i;
    if (idx < options.length) {
      const isSel = idx === selected;
      const rmarker = isSel ? `${c.cyan}▸${c.reset} ` : '  ';
      let label = options[idx];
      if (isSel) label = `${c.bold}${c.reverse}${label}${c.reset}`;
      right = `${rmarker}${label}`;
      if (i === 0 && start > 0) right += ` ${c.dim}▲${c.reset}`;
      if (i === listH - 1 && start + listH < options.length) right += ` ${c.dim}▼${c.reset}`;
      right = padRight(truncate(right, rw), rw);
    } else {
      right = ' '.repeat(rw);
    }
    out.push(side(`${left}${c.cyan}${c.dim}│${c.reset}${right}`));
  }
  out.push(border(`└${'─'.repeat(inner)}┘`));
  return out;
}

function inputBoxLayout() {
  const rows = Math.max(20, stdout.rows || 24);
  const maxInputLines = Math.max(1, rows - 6 - helpLineCount());
  const vrows = visualRows();
  const useHL = !!state.hlRange;
  const focusRow = useHL ? rowOfOffset(state.hlRange.b) : caretLine();
  let top = 0;
  if (vrows.length > maxInputLines) {
    top = Math.min(Math.max(0, focusRow - maxInputLines + 1), vrows.length - maxInputLines);
  }
  return { top, maxInputLines, vrows, rows };
}

function offsetAtScreen(R, C) {
  if (R < 4) return null;
  const { top, maxInputLines, vrows } = inputBoxLayout();
  const i = R - 4;
  if (i < 0) return null;
  const vIndex = top + i;
  if (vIndex >= vrows.length) return state.input.length;
  const { start, end } = vrows[vIndex];
  const raw = state.input.slice(start, end);
  const contentX = Math.max(0, C - 3);
  let w = 0;
  for (let k = 0; k < raw.length; k++) {
    const cw = cjkWidth(raw[k]);
    if (w + cw > contentX) return start + k;
    w += cw;
  }
  return end;
}

function menuView() {
  const rows = Math.max(20, stdout.rows || 24);
  const cols = Math.max(60, stdout.columns || 80);
  const listH = Math.max(3, Math.min(10, rows - 8));
  const { options, selected } = tabOptions();
  let start = 0;
  if (options.length > listH) {
    start = Math.max(0, Math.min(selected - Math.floor(listH / 2), options.length - listH));
  }
  const lang = menuTabLang();
  const groups = hasMenuPanes() ? groupsOf(lang) : null;
  let pw = 0;
  if (groups) {
    const dialogW = Math.min(cols - 2, 96);
    const inner = dialogW - 2;
    const content = inner - 2;
    pw = Math.max(9, Math.min(14, Math.max(...groups.map((g) => displayWidth(g))) + 3));
  }
  return { listH, options, selected, start, groups, pw, rows, cols };
}

function menuTabAt(contentX) {
  const tabs = menuTabNames();
  const prefix = 'Tabs:  ';
  if (contentX < prefix.length) return -1;
  let x = prefix.length;
  for (let t = 0; t < tabs.length; t++) {
    const w = displayWidth(tabs[t]);
    if (contentX >= x && contentX < x + w) return t;
    x += w + 2;
  }
  return -1;
}

function hitTestMenu(R, C) {
  const mv = menuView();
  const dialogW = Math.min(mv.cols - 2, 96);
  const listH = mv.listH;
  const dH = 3 + listH + 1;
  const top = Math.max(0, Math.floor((mv.rows - dH) / 2));
  const left = Math.max(0, Math.floor((mv.cols - dialogW) / 2));
  const sr = R - 1;
  if (sr < top || sr >= top + dH) return { type: 'outside' };
  const sc = C - 1;
  if (sc < left || sc >= left + dialogW) return { type: 'outside' };
  const k = sr - top;
  const contentX = C - left - 3;
  if (k === 1) return { type: 'tab', x: contentX };
  if (k >= 3 && k < 3 + listH) return { type: 'list', idx: k - 3, x: contentX };
  return { type: 'border' };
}

function setMenuGroup(gi) {
  const lang = menuTabLang();
  if (!lang) return;
  const groups = groupsOf(lang);
  gi = Math.max(0, Math.min(groups.length - 1, gi));
  state.menuGroup = gi;
  const groupVoices = visibleGroupVoices(lang);
  const cur = state.voiceByLang[lang.code] ?? 0;
  if (!groupVoices.some((v) => lang.voices.indexOf(v) === cur)) {
    state.voiceByLang[lang.code] = lang.voices.indexOf(groupVoices[0]);
  }
  state.status = `${c.green}Group:${c.reset} ${groups[gi]}`;
  saveSelection();
  redraw();
}

function selectVoiceAt(index) {
  const lang = menuTabLang();
  if (!lang) return false;
  const groupVoices = visibleGroupVoices(lang);
  if (index < 0 || index >= groupVoices.length) return false;
  const voice = groupVoices[index];
  state.voiceByLang[lang.code] = lang.voices.indexOf(voice);
  if (state.busy) voiceChanged = true;
  const hint = providerAvailable(voice) ? '' : ` ${c.yellow}⚠ ${installHintFor(voice) || voice.source + ' unavailable'}${c.reset}`;
  state.status = `${c.green}Voice:${c.reset} ${lang.name} → ${voiceLabel(voice)}${hint}`;
  saveSelection();
  return true;
}

function activateMenuOption(optIndex) {
  const kind = menuTabKind();
  if (kind === 'lang') {
    selectVoiceAt(optIndex);
  } else if (kind === 'speed') {
    if (optIndex >= 0 && optIndex < SPEEDS.length) {
      state.speed = SPEEDS[optIndex];
      state.status = `${c.green}Speed:${c.reset} ${state.speed}×`;
    }
  } else {
    if (optIndex >= 0 && optIndex < MODES.length) {
      state.mode = MODES[optIndex].id;
      state.status = `${c.green}Mode:${c.reset} ${state.mode === 'play' ? 'play audio' : 'save audio'}`;
    }
  }
  state.menuOpen = false;
  saveSelection();
  redraw();
}

function handleMousePress(x, y, button) {
  if (button !== 0) return;
  if (state.menuOpen) {
    const hit = hitTestMenu(y, x);
    if (hit.type === 'tab') {
      const t = menuTabAt(hit.x);
      if (t >= 0) {
        state.menuCursor = t;
        state.menuGroup = 0;
        state.menuPane = 'right';
        state.status = `${c.green}Tab:${c.reset} ${menuTabNames()[t]}`;
        redraw();
      }
    } else if (hit.type === 'list') {
      const mv = menuView();
      if (mv.groups) {
        if (hit.x < mv.pw) {
          if (hit.idx < mv.groups.length) setMenuGroup(hit.idx);
        } else {
          const oi = mv.start + hit.idx;
          if (oi < mv.options.length) activateMenuOption(oi);
        }
      } else {
        const oi = mv.start + hit.idx;
        if (oi < mv.options.length) activateMenuOption(oi);
      }
    } else if (hit.type === 'outside') {
      state.menuOpen = false;
      redraw();
    }
    return;
  }
  if (state.busy) return;
  const off = offsetAtScreen(y, x);
  if (off === null) return;
  breakHistory();
  clearSegSelection();
  state.caret = off;
  state.anchor = off;
  state.mouseSelecting = true;
  redraw();
}

function handleMouseDrag(x, y) {
  if (state.menuOpen) return;
  if (!state.mouseSelecting) return;
  let off = offsetAtScreen(y, x);
  if (off === null) off = y < 4 ? 0 : state.input.length;
  state.caret = off;
  redraw();
}

function handleMouseRelease() {
  state.mouseSelecting = false;
}

function parseMouse(s, i) {
  let j = i + 3;
  const nums = [];
  let cur = '';
  let endChar = '';
  while (j < s.length) {
    const ch = s[j];
    if (ch === ';') {
      nums.push(cur === '' ? 0 : parseInt(cur, 10));
      cur = '';
      j++;
      continue;
    }
    if (ch === 'M' || ch === 'm') {
      endChar = ch;
      nums.push(cur === '' ? 0 : parseInt(cur, 10));
      j++;
      break;
    }
    if (ch < '0' || ch > '9') return null;
    cur += ch;
    j++;
  }
  if (endChar === '') return null;
  if (nums.length < 3) return null;
  return { button: nums[0], x: nums[1], y: nums[2], release: endChar === 'm', len: j - i };
}

function handleMouse(button, x, y, release) {
  if (release) { handleMouseRelease(); return; }
  const b = (button & ~32) & 3;
  if (button >= 32) handleMouseDrag(x, y);
  else handleMousePress(x, y, b);
}

function truncateAnsi(s, maxWidth) {
  let w = 0;
  let out = '';
  let esc = false;
  for (const ch of s) {
    if (esc) {
      out += ch;
      if (ch === 'm') esc = false;
      continue;
    }
    if (ch === '\x1b') {
      out += ch;
      esc = true;
      continue;
    }
    const cw = cjkWidth(ch);
    if (w + cw > maxWidth) break;
    w += cw;
    out += ch;
  }
  return out;
}

function styledLine(raw, absStart, selA, selB) {
  let out = '';
  let inSel = false;
  for (let j = 0; j < raw.length; j++) {
    const abs = absStart + j;
    const sel = abs >= selA && abs < selB;
    if (sel && !inSel) { out += c.reverse; inSel = true; }
    if (!sel && inSel) { out += c.reset; inSel = false; }
    out += raw[j];
  }
  if (inSel) out += c.reset;
  return out;
}

function renderCaretLine(raw, absStart, caretOffset, selA, selB) {
  let out = '';
  let inSel = false;
  const flush = (sel) => {
    if (sel && !inSel) { out += c.reverse; inSel = true; }
    if (!sel && inSel) { out += c.reset; inSel = false; }
  };
  for (let j = 0; j < raw.length; j++) {
    const abs = absStart + j;
    const sel = abs >= selA && abs < selB;
    flush(sel);
    if (j === caretOffset && !sel) {
      out += `${c.bgCyan}${c.black}${raw[j]}${c.reset}`;
      if (inSel) out += c.reverse;
    } else {
      out += raw[j];
    }
  }
  if (inSel) out += c.reset;
  if (caretOffset >= raw.length) {
    out += `${c.bgCyan}${c.black} ${c.reset}`;
  }
  return out;
}

function renderInputBox(maxLines, borderColor) {
  const width = state.boxWidth;
  const inner = width - 2;
  const content = inner - 2;
  const rows = visualRows();
  const useHL = !!state.hlRange;
  const cl = caretLine();
  const focusRow = useHL ? rowOfOffset(state.hlRange.b) : cl;
  let top = 0;
  if (rows.length > maxLines) {
    top = Math.min(Math.max(0, focusRow - maxLines + 1), rows.length - maxLines);
  }
  if (!borderColor) borderColor = state.menuOpen ? c.gray : c.cyan;
  const border = (s) => `${borderColor}${s}${c.reset}`;

  const a = useHL ? state.hlRange.a : Math.min(state.anchor, state.caret);
  const b = useHL ? state.hlRange.b : Math.max(state.anchor, state.caret);

  const out = [border(`┌${'─'.repeat(inner)}┐`)];
  for (let i = 0; i < maxLines; i++) {
    const idx = top + i;
    let cell = '';
    if (idx < rows.length) {
      const { start, end } = rows[idx];
      const raw = state.input.slice(start, end).join('');
      if (!useHL && idx === cl) {
        const caretOffset = state.caret - start;
        cell = renderCaretLine(raw, start, caretOffset, a, b);
      } else {
        cell = styledLine(raw, start, a, b);
      }
    }
    cell = padRight(truncateAnsi(cell, content), content);
    out.push(`${borderColor}│ ${c.reset}${cell}${borderColor} │${c.reset}`);
  }
  out.push(border(`└${'─'.repeat(inner)}┘`));
  return out;
}

function draw() {
  const rows = Math.max(20, stdout.rows || 24);
  const cols = Math.max(60, stdout.columns || 80);
  state.boxWidth = cols;
  const inner = cols - 2;
  const content = inner - 2;

  const focusTag = state.menuOpen
    ? `${c.cyan}MENU${c.reset}`
    : `${c.green}TEXT${c.reset}`;
  const totalLines = Math.max(1, lineCount());
  const cl = Math.min(caretLine() + 1, totalLines);
  const header = `${c.bold}VOICE${c.reset} ${c.dim}TTS · edge · ${state.speed}×${c.reset}`;
  const subheader = `${c.gray}Input:${c.reset} ${c.dim}focus${c.reset} ${focusTag}  ${c.dim}Ln ${cl}/${totalLines} · ${state.input.length} chars${c.reset}  ${c.gray}${state.spoken} spoken · ${state.history.length} history${c.reset}`;
  const helpLines = wrapText(HELP_TEXT, cols).slice(0, 3);
  const maxInputLines = Math.max(1, rows - 6 - helpLines.length);
  const borderColor = state.menuOpen ? c.gray : c.cyan;

  if (!state.menuOpen) {
    const lines = [header, subheader];
    lines.push(...renderInputBox(maxInputLines, borderColor));
    lines.push('', truncate(state.status, cols) + c.reset, ...helpLines.map((l) => c.dim + l + c.reset));
    while (lines.length < rows) lines.push('');
    if (lines.length > rows) lines.length = rows;
    writeLines(lines);
    return;
  }

  const bg = [header, subheader];
  bg.push(...renderInputBox(maxInputLines, borderColor));
  bg.push('', truncate(state.status, cols) + c.reset, ...helpLines.map((l) => c.dim + l + c.reset));
  while (bg.length < rows) bg.push('');
  if (bg.length > rows) bg.length = rows;

  const listH = Math.max(3, Math.min(10, rows - 8));
  const dialogW = Math.min(cols - 2, 96);
  const dialogLines = buildDialog(dialogW, listH);
  const dH = dialogLines.length;
  const top = Math.max(0, Math.floor((rows - dH) / 2));
  const left = Math.max(0, Math.floor((cols - dialogW) / 2));
  const pad = ' '.repeat(left);
  for (let k = 0; k < dH; k++) {
    const r = top + k;
    if (r < rows) bg[r] = pad + dialogLines[k];
  }
  writeLines(bg);
}

function writeLines(lines) {
  const prev = state.lastLines;
  const full = state.fullClear || prev === null;
  let out = '\x1b[?25l';
  if (full) out += '\x1b[2J\x1b[H';
  const max = Math.max(prev ? prev.length : 0, lines.length);
  for (let k = 0; k < max; k++) {
    const cur = lines[k];
    const old = prev ? prev[k] : undefined;
    if (!full && cur === old) continue;
    if (cur === undefined) {
      out += `\x1b[${k + 1};1H\x1b[K`;
    } else {
      out += `\x1b[${k + 1};1H\x1b[K${cur}`;
    }
  }
  process.stdout.write(out);
  state.lastLines = lines;
  state.fullClear = false;
}

function redraw() {
  draw();
}

async function ensureTtsDir() {
  await mkdir(TTS_DIR, { recursive: true });
}

async function loadHistory() {
  try {
    await ensureTtsDir();
    const data = await readFile(HISTORY_PATH, 'utf-8');
    const arr = JSON.parse(data);
    if (Array.isArray(arr)) {
      state.history = arr.filter((s) => typeof s === 'string').slice(-HISTORY_LIMIT);
    }
  } catch {}
}

async function saveHistory() {
  try {
    await ensureTtsDir();
    await writeFile(HISTORY_PATH, JSON.stringify(state.history, null, 2), 'utf-8');
  } catch {}
}

async function loadSelection() {
  try {
    const data = JSON.parse(await readFile(SELECTION_PATH, 'utf-8'));
    if (data && typeof data === 'object') {
      if (data.voiceByLang && typeof data.voiceByLang === 'object') {
        for (const l of LANGUAGES) {
          const v = data.voiceByLang[l.code];
          if (typeof v === 'number' && v >= 0) state.voiceByLang[l.code] = v;
        }
      }
      if (typeof data.mode === 'string') state.mode = data.mode;
      if (typeof data.speed === 'number') state.speed = data.speed;
      if (typeof data.tab === 'number' && data.tab >= 0) state.menuCursor = data.tab;
    }
  } catch {}
}

async function saveSelection() {
  try {
    await ensureTtsDir();
    await writeFile(
      SELECTION_PATH,
      JSON.stringify({
        voiceByLang: state.voiceByLang,
        mode: state.mode,
        speed: state.speed,
        tab: state.menuCursor,
      }),
    );
  } catch {}
}

const cache = {
  map: new Map(),
  order: [],
};

function canonicalVoiceKey(v) {
  return `edge:${v.edge}`;
}

function cacheKey(text, voice) {
  const h = createHash('sha256').update(text).digest('hex');
  return `${h}:${canonicalVoiceKey(voice)}`;
}

async function loadCache() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const data = JSON.parse(await readFile(CACHE_INDEX_PATH, 'utf-8'));
    if (Array.isArray(data.entries)) {
      for (const e of data.entries) {
        if (!cache.map.has(e.key)) {
          cache.map.set(e.key, { hash: e.hash, ext: e.ext });
          cache.order.push(e.key);
        }
      }
    }
  } catch {}
}

function touchCache(key) {
  const i = cache.order.indexOf(key);
  if (i !== -1) cache.order.splice(i, 1);
  cache.order.push(key);
}

async function readCache(key) {
  const e = cache.map.get(key);
  if (!e) return null;
  touchCache(key);
  try {
    return await readFile(path.join(CACHE_DIR, `${e.hash}.${e.ext}`));
  } catch {
    cache.map.delete(key);
    cache.order = cache.order.filter((k) => k !== key);
    return null;
  }
}

async function writeCache(key, engine, buffer) {
  await mkdir(CACHE_DIR, { recursive: true });
  const ext = 'mp3';
  const hash = createHash('sha256').update(key).digest('hex');
  cache.map.set(key, { hash, ext });
  touchCache(key);
  while (cache.order.length > CACHE_MAX) {
    const oldKey = cache.order.shift();
    const oe = cache.map.get(oldKey);
    cache.map.delete(oldKey);
    if (oe) {
      try { await unlink(path.join(CACHE_DIR, `${oe.hash}.${oe.ext}`)); } catch {}
    }
  }
  await writeFile(path.join(CACHE_DIR, `${hash}.${ext}`), buffer);
  await saveCacheIndex();
}

async function saveCacheIndex() {
  const entries = cache.order.map((k) => ({ key: k, ...cache.map.get(k) }));
  try {
    await writeFile(CACHE_INDEX_PATH, JSON.stringify({ entries }));
  } catch {}
}

async function speakCurrent() {
  const a = Math.min(state.anchor, state.caret);
  const b = Math.max(state.anchor, state.caret);
  const joined = (a !== b ? state.input.slice(a, b) : state.input).join('');
  const lead = joined.length - joined.trimStart().length;
  const text = joined.trim();
  if (!text || state.busy) return;
  state.busy = true;
  state.stopRequested = false;
  state.segments = [];
  state.segIndex = -1;
  state.hlRange = null;

  const base = (a !== b ? a : 0) + lead;
  const pieces = splitTtsSegments(text, MAX_SEGMENT_LENGTH).map((seg) => ({
    text: seg.text,
    lang: seg.lang,
    absStart: base + seg.indexStart,
    absEnd: base + seg.indexEnd + 1,
  }));
  state.segments = pieces;
  const n = pieces.length;

  const finish = async (status, keepHighlight = false) => {
    if (!keepHighlight) {
      state.segments = [];
      state.segIndex = -1;
      state.hlRange = null;
    }
    state.busy = false;
    state.menuOpen = false;
    state.status = status;
    draw();
  };

  try {
    let lastEngine = '';
    voiceChanged = false;
    const prefetch = (idx) =>
      synthesize(pieces[idx].text, langOf(pieces[idx].lang), voiceForLang(pieces[idx].lang), { quiet: idx > 0 })
        .then((r) => ({ ok: true, ...r }), (e) => ({ ok: false, error: e }));
    let pending = prefetch(0);
    for (let i = 0; i < n; i++) {
      if (state.stopRequested) break;
      state.segIndex = i;
      state.hlRange = { a: pieces[i].absStart, b: pieces[i].absEnd };
      const segLang = langOf(pieces[i].lang);
      const slow = await Promise.race([
        pending.then(() => false, () => false),
        new Promise((r) => setTimeout(() => r(true), 200)),
      ]);
      if (slow) {
        state.status = `${c.yellow}Synth${c.reset} ${progressBar(i / n, 10)} ${i}/${n} ${c.gray}· ${segLang.name} · ${pieces[i].text.length} chars${c.reset}`;
        draw();
      }
      let cur = await pending;
      pending = null;
      if (!cur.ok) throw cur.error;
      if (voiceChanged) {
        voiceChanged = false;
        state.status = `${c.yellow}Switching voice${c.reset} ${c.gray}· ${voiceLabel(voiceForLang(pieces[i].lang))}${c.reset}`;
        draw();
        cur = await synthesize(pieces[i].text, langOf(pieces[i].lang), voiceForLang(pieces[i].lang), { quiet: false })
          .then((r) => ({ ok: true, ...r }), (e) => ({ ok: false, error: e }));
        if (!cur.ok) throw cur.error;
      }
      const { buffer, engine, voice: usedVoice } = cur;
      lastEngine = engine;
      if (state.stopRequested) break;
      if (i + 1 < n && !state.stopRequested) pending = prefetch(i + 1);
      const segExt = 'mp3';
      if (state.mode === 'save') {
        state.saveSeq += 1;
        const file = path.resolve(`voice_${segLang.code}_${String(state.saveSeq).padStart(3, '0')}.${segExt}`);
        await writeFile(file, buffer);
        state.status = `${c.green}Saved${c.reset} ${file} (${engine}, ${buffer.length} bytes)`;
        draw();
        continue;
      }
      await playSegmentWithTimer(i, n, segLang, usedVoice, engine, buffer);
      if (state.stopRequested) break;
    }
    if (state.stopRequested) {
      state.stopRequested = false;
      clearSegmentTimer();
      await finish(`${c.yellow}Stopped.${c.reset}`, true);
      return;
    }
    state.spoken += 1;
    const fullText = state.input.join('').trim();
    if (fullText && (state.history.length === 0 || state.history[state.history.length - 1] !== fullText)) {
      state.history.push(fullText);
      if (state.history.length > HISTORY_LIMIT) state.history.shift();
      await saveHistory();
    }
    state.historyIndex = -1;
    if (state.mode === 'save') {
      await finish(`${c.green}Saved${c.reset} ${n} segment(s)`);
    } else {
      await finish(`${c.green}Played${c.reset} ${n} segment(s) · ${lastEngine}`);
    }
  } catch (error) {
    clearSegmentTimer();
    const message = error instanceof Error ? error.message : String(error);
    await finish(`${c.red}${message}${c.reset}`);
  }
}

function quit() {
  process.stdout.write('\x1b[?25h\x1b[?1006l\x1b[?1002l\x1b[?1049l');
  stdin.setRawMode(false);
  stdin.pause();
  console.log(`\nBye. ${state.spoken} utterance(s).`);
  process.exit(0);
}

let pending = '';

let voiceChanged = false;

function handleEscape() {
  if (state.busy) {
    stopPlayback();
    return;
  }
  if (state.menuOpen) {
    state.menuOpen = false;
    redraw();
  }
}

function handleHome() {
  if (state.busy) return;
  clearSegSelection();
  state.caret = lineStart(caretLine());
  state.anchor = state.caret;
  redraw();
}

function handleEnd() {
  if (state.busy) return;
  clearSegSelection();
  state.caret = lineEnd(caretLine());
  state.anchor = state.caret;
  redraw();
}

function handleShiftArrow(dir) {
  if (state.busy && !state.menuOpen) return;
  if (state.menuOpen) {
    if (dir === 'A') moveMenuVertical(-1);
    else if (dir === 'B') moveMenuVertical(1);
    else if (dir === 'C') moveMenuHorizontal(1);
    else if (dir === 'D') moveMenuHorizontal(-1);
    state.anchor = state.caret;
    redraw();
    return;
  }
  clearSegSelection();
  if (dir === 'A') moveVertical(-1);
  else if (dir === 'B') moveVertical(1);
  else if (dir === 'C') state.caret = Math.min(state.input.length, state.caret + 1);
  else if (dir === 'D') state.caret = Math.max(0, state.caret - 1);
  else if (dir === 'H') state.caret = lineStart(caretLine());
  else if (dir === 'F') state.caret = lineEnd(caretLine());
  // anchor unchanged -> extends selection
  redraw();
}

function onData(chunk) {
  const s = pending + chunk;
  pending = '';

  let i = 0;
  let prevNL = false;
  while (i < s.length) {
    const ch = s[i];

    if (ch === '\x03' || ch === '\x04' || ch === '\x11') {
      if (state.busy) stopPlayback();
      else quit();
      return;
    }

    if (ch === '\x1b') {
      if (s[i + 1] === '[' && s[i + 2] === '<') {
        const m = parseMouse(s, i);
        if (!m) { pending = s.slice(i); break; }
        handleMouse(m.button, m.x, m.y, m.release);
        i += m.len;
        prevNL = false;
        continue;
      }
      if (s.length - i < 2) {
        handleEscape();
        i += 1;
        prevNL = false;
        continue;
      }
      const altSeq = s.slice(i, i + 2);
      if (altSeq === '\x1b\r') {
        if (!state.busy) speakCurrent();
        i += 2;
        prevNL = false;
        continue;
      }
      const nxt = s[i + 1];
      if (nxt !== '[') {
        handleEscape();
        i += 2;
        prevNL = false;
        continue;
      }
      if (s.length - i >= 6 && s.slice(i, i + 4) === '\x1b[1;') {
        handleShiftArrow(s[i + 5]);
        i += 6;
        prevNL = false;
        continue;
      }
      if (s.length - i < 3) {
        pending = s.slice(i);
        break;
      }
      const seq4 = s.slice(i, i + 4);
      if (seq4 === '\x1b[5~') {
        if (!state.busy) historyPageUp();
        i += 4;
        prevNL = false;
        continue;
      }
      if (seq4 === '\x1b[6~') {
        if (!state.busy) historyPageDown();
        i += 4;
        prevNL = false;
        continue;
      }
      if (seq4 === '\x1b[3~') {
        if (!state.busy) { breakHistory(); clearSegSelection(); deleteForward(); redraw(); }
        i += 4;
        prevNL = false;
        continue;
      }
      if (seq4 === '\x1b[1~') {
        handleHome();
        i += 4;
        prevNL = false;
        continue;
      }
      if (seq4 === '\x1b[4~') {
        handleEnd();
        i += 4;
        prevNL = false;
        continue;
      }
      const seq = s.slice(i, i + 3);
      if (seq === '\x1b[A') {
        if (!state.busy || state.menuOpen) {
          if (state.menuOpen) { moveMenuVertical(-1); state.anchor = state.caret; }
          else { clearSegSelection(); moveVertical(-1); state.anchor = state.caret; }
          redraw();
        }
        i += 3;
        prevNL = false;
        continue;
      }
      if (seq === '\x1b[B') {
        if (!state.busy || state.menuOpen) {
          if (state.menuOpen) { moveMenuVertical(1); state.anchor = state.caret; }
          else { clearSegSelection(); moveVertical(1); state.anchor = state.caret; }
          redraw();
        }
        i += 3;
        prevNL = false;
        continue;
      }
      if (seq === '\x1b[D') {
        if (!state.busy || state.menuOpen) {
          if (state.menuOpen) { moveMenuHorizontal(-1); state.anchor = state.caret; }
          else { clearSegSelection(); state.caret = Math.max(0, state.caret - 1); state.anchor = state.caret; }
          redraw();
        }
        i += 3;
        prevNL = false;
        continue;
      }
      if (seq === '\x1b[C') {
        if (!state.busy || state.menuOpen) {
          if (state.menuOpen) { moveMenuHorizontal(1); state.anchor = state.caret; }
          else { clearSegSelection(); state.caret = Math.min(state.input.length, state.caret + 1); state.anchor = state.caret; }
          redraw();
        }
        i += 3;
        prevNL = false;
        continue;
      }
      if (seq === '\x1b[H') {
        handleHome();
        i += 3;
        prevNL = false;
        continue;
      }
      if (seq === '\x1b[F') {
        handleEnd();
        i += 3;
        prevNL = false;
        continue;
      }
      if (seq === '\x1bOH') {
        handleHome();
        i += 3;
        prevNL = false;
        continue;
      }
      if (seq === '\x1bOF') {
        handleEnd();
        i += 3;
        prevNL = false;
        continue;
      }
      i += 1;
      prevNL = false;
      continue;
    }

    if (ch === '\t') {
      state.menuOpen = !state.menuOpen;
      redraw();
      i += 1;
      prevNL = false;
      continue;
    }

    if (state.busy) {
      i += 1;
      prevNL = false;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (state.menuOpen) {
        i += 1;
        prevNL = false;
        continue;
      }
      if (!prevNL) {
        breakHistory();
        deleteSelection();
        clearSegSelection();
        state.input.splice(state.caret, 0, '\n');
        state.caret += 1;
        state.anchor = state.caret;
        redraw();
      }
      prevNL = true;
      i += 1;
      continue;
    }

    if (ch === '\x7f' || ch === '\x08') {
      breakHistory();
      clearSegSelection();
      backspace();
      redraw();
      i += 1;
      prevNL = false;
      continue;
    }

    if (ch === '\x0c') {
      focusMenuItem(0);
      i += 1;
      prevNL = false;
      continue;
    }
    if (ch === '\x16') {
      focusMenuItem(1);
      i += 1;
      prevNL = false;
      continue;
    }
    if (ch === '\x0f') {
      focusMenuItem(2);
      i += 1;
      prevNL = false;
      continue;
    }

    if (ch === '\x0b') {
      state.input = [];
      state.caret = 0;
      state.anchor = 0;
      clearSegSelection();
      if (state.historyIndex !== -1) { state.historyIndex = -1; }
      redraw();
      i += 1;
      prevNL = false;
      continue;
    }

    if (ch === '\x01') {
      breakHistory();
      clearSegSelection();
      state.anchor = 0;
      state.caret = state.input.length;
      redraw();
      i += 1;
      prevNL = false;
      continue;
    }

    const cpStr = String.fromCodePoint(s.codePointAt(i));
    if (state.menuOpen) state.menuOpen = false;
    deleteSelection();
    breakHistory();
    clearSegSelection();
    state.input.splice(state.caret, 0, cpStr);
    state.caret += 1;
    state.anchor = state.caret;
    redraw();
    i += cpStr.length;
    prevNL = false;
  }
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('voice.mjs requires an interactive terminal.');
    process.exitCode = 1;
    return;
  }
  await ensureTtsDir();
  await loadHistory();
  await loadCache();

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf-8');
  stdout.on('resize', () => { state.fullClear = true; redraw(); });

  state.voiceByLang = Object.fromEntries(LANGUAGES.map((l) => [l.code, 0]));
  await loadSelection();
  state.status = `${c.green}Ready.${c.reset} Enter = newline, Alt+Enter = speak.`;

  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1002h\x1b[?1006h');
  draw();
  stdin.on('data', onData);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
