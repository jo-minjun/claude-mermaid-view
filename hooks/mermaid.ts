import { renderMermaidASCII } from './vendor/beautiful-mermaid.js'

export type MermaidBlock = {
  start: number
  end: number
  indent: string
  source: string
}

/** 답변을 닫힌 mermaid 블록마다 끊은 조각. `block`이 있으면 그 블록으로 끝난다 */
export type ReplyPart = {
  text: string
  block?: {
    /** 메시지 안에서 0부터 센 블록 순번 */
    index: number
    source: string
    isDrawn: boolean
    /** mermaid.live에서 여는 주소. 링크에 담기에 너무 길면 없다 */
    liveUrl?: string
  }
}

export type RewriteResult = {
  text: string
  parts: ReplyPart[]
}

// 들여쓰기 앞에 인용문 표시(`> `)가 붙은 블록도 잡는다
const MERMAID_FENCE =
  /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n(?:[ \t]*>)*[ \t]*\2[ \t]*$/gm
const QUOTE_MARKER = /^[ \t]*>[ \t]?/
const QUOTE_MARKERS = /^(?:[ \t]*>[ \t]?)*/

// 터미널에서 2칸을 차지하는 글자: 한글, CJK, 전각 기호, 기본으로 그림으로 그리는 이모지(✅, 😀 등)
const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Emoji_Presentation}/gu

// 렌더러는 글자 폭을 문자열 length로 세므로, 넓은 글자 뒤에 모자란 칸만큼 1칸짜리 채움 글자를 붙여
// 자리를 잡게 한 뒤 출력에서 지운다. 😀처럼 서로게이트 쌍인 글자는 이미 2로 세어져 붙이지 않는다.
// state 다이어그램의 이름이 \p{L} 만 받아서 채움 글자도 문자(Lisu, U+A4D0)여야 하고,
// 실제 다이어그램에 나올 일이 거의 없는 것을 고른다.
const WIDTH_PAD = 'ꓐ'

// 화면보다 넓을 때 한 번 더 그려 보는 좁은 간격. flowchart·state 렌더러만 읽는다.
// paddingY를 3보다 줄이면 간선 라벨이 상자 테두리를 덮어쓴다.
const COMPACT_LAYOUT = { paddingX: 2, paddingY: 3, boxBorderPadding: 0 }

// sequence 렌더러는 간격 옵션을 읽지 않아서, 넓으면 라벨을 줄바꿈해 다시 그린다.
// 라벨 한 줄의 최대 칸 수를 큰 값부터 줄여 가며 시도한다.
const SEQUENCE_WRAP_COLUMNS = [40, 30, 20]

// 렌더러의 participant·메시지 문법과 같은 모양
const SEQUENCE_HEADER = /^sequenceDiagram\s*$/i
const PARTICIPANT_LINE = /^(\s*(?:participant|actor)\s+\S+?\s+as\s+)(.+)$/
const MESSAGE_LINE = /^(\s*(\S+?)\s*(?:--?>?>|--?[)x]|--?>>|--?>)\s*[+-]?(\S+?)\s*:\s*)(.+)$/
const LINE_BREAK = /<br\s*\/?>|\\n/i

// mod 런타임에 CompressionStream이 없어 mermaid.live의 압축(pako) 대신 base64 형식을 쓴다
const MERMAID_LIVE_URL = 'https://mermaid.live/edit#base64:'
// Link가 받는 href 최대 길이
const LINK_MAX_LENGTH = 2048

const CACHE_LIMIT = 64
const cache = new Map<string, string | null>()

export function findMermaidBlocks(text: string): MermaidBlock[] {
  return [...text.matchAll(MERMAID_FENCE)].map(match => {
    const indent = match[1] ?? ''
    const source = (match[3] ?? '')
      .split('\n')
      .map(line => stripPrefix(line, indent))
      .join('\n')

    return { start: match.index, end: match.index + match[0].length, indent, source }
  })
}

// 인용문 안의 빈 줄은 `>` 뒤 공백이 없을 수 있어서, 표시는 깊이만큼 하나씩 떼고 나머지 들여쓰기를 뗀다
function stripPrefix(line: string, indent: string): string {
  let rest = line
  for (let depth = indent.split('>').length - 1; depth > 0; depth--) {
    rest = rest.replace(QUOTE_MARKER, '')
  }
  const innerIndent = indent.replace(QUOTE_MARKERS, '')

  return rest.startsWith(innerIndent) ? rest.slice(innerIndent.length) : rest
}

export function displayWidth(line: string): number {
  return [...line].length + (line.match(WIDE_CHAR)?.length ?? 0)
}

export function renderDiagram(source: string, compact = false): string | null {
  const key = JSON.stringify([source, compact])
  const cached = cache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const art = renderUncached(source, compact)
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(key, art)

  return art
}

function renderUncached(source: string, compact: boolean): string | null {
  try {
    const padded = source.replace(WIDE_CHAR, char => char + WIDTH_PAD.repeat(2 - char.length))
    const art = renderMermaidASCII(padded, { colorMode: 'none', ...(compact ? COMPACT_LAYOUT : {}) })
      .split(WIDTH_PAD)
      .join('')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .replace(/^\n+|\n+$/g, '')

    // 문법을 못 읽으면 예외 대신 빈 출력을 내는 경우가 있다
    return art === '' ? null : art
  } catch {
    return null
  }
}

/**
 * 넘치면 다시 그려 본다: flowchart 등은 좁은 간격으로, sequence는 라벨을 줄바꿈해서.
 * 그래도 넘치면 null
 */
function renderFitting(source: string, maxColumns: number | undefined): string | null {
  const fits = (art: string | null) =>
    art !== null && (maxColumns === undefined || Math.max(...art.split('\n').map(displayWidth)) <= maxColumns)

  const art = renderDiagram(source)
  if (art === null || fits(art)) {
    return art
  }

  const retries = SEQUENCE_HEADER.test(source.trim().split('\n')[0]?.trim() ?? '')
    ? SEQUENCE_WRAP_COLUMNS.map(columns => () => renderDiagram(wrapSequenceLabels(source, columns)))
    : [() => renderDiagram(source, true)]
  for (const retry of retries) {
    const again = retry()
    if (fits(again)) {
      return again
    }
  }

  return null
}

/** 참가자 표시 이름과 메시지 라벨을 `maxColumns` 칸 안쪽으로 줄바꿈한 원문 */
function wrapSequenceLabels(source: string, maxColumns: number): string {
  return source
    .split('\n')
    .map(line => {
      const participant = line.match(PARTICIPANT_LINE)
      if (participant) {
        return participant[1] + wrapLabel(participant[2]!, maxColumns)
      }
      // 자기 메시지는 렌더러가 줄바꿈을 나누지 않고 그대로 찍어 다이어그램이 깨진다
      const message = line.match(MESSAGE_LINE)
      if (message && message[2] !== message[3]) {
        return message[1] + wrapLabel(message[4]!, maxColumns)
      }

      return line
    })
    .join('\n')
}

function wrapLabel(label: string, maxColumns: number): string {
  return label
    .split(LINE_BREAK)
    .flatMap(line => {
      const wrapped: string[] = []
      for (const word of line.trim().split(/\s+/)) {
        const last = wrapped.at(-1)
        // 한 단어가 한도보다 길면 끊지 않고 그 줄에 그대로 둔다
        if (last !== undefined && displayWidth(`${last} ${word}`) <= maxColumns) {
          wrapped[wrapped.length - 1] = `${last} ${word}`
        } else {
          wrapped.push(word)
        }
      }

      return wrapped
    })
    .join('<br>')
}

/**
 * mermaid 블록을 텍스트 다이어그램 코드 블록으로 바꾼다. 변환에 실패했거나
 * 다시 그려도 `maxColumns`보다 넓은 블록은 원문 그대로 둔다. 어느 쪽이든 닫힌 블록 뒤에서 끊는다.
 */
export function rewriteMermaid(
  text: string,
  options: { maxColumns?: number; isSourceOpen: (index: number) => boolean },
): RewriteResult {
  const blocks = findMermaidBlocks(text)
  const parts: ReplyPart[] = []
  let cursor = 0

  blocks.forEach((block, index) => {
    // 들여쓰기와 인용문 표시가 차지하는 칸만큼 다이어그램이 쓸 폭이 줄어든다
    const maxColumns =
      options.maxColumns === undefined ? undefined : options.maxColumns - displayWidth(block.indent)
    const art = renderFitting(block.source, maxColumns)
    const liveUrl = liveEditorUrl(block.source) ?? undefined
    let part = text.slice(cursor, block.end)
    if (art !== null) {
      part = text.slice(cursor, block.start) + fence(block.indent, '', art)
      if (options.isSourceOpen(index)) {
        // 사이의 빈 줄에도 인용문 표시를 남겨야 인용문이 끊기지 않는다
        part += `\n${block.indent.trimEnd()}\n` + fence(block.indent, 'mermaid', block.source)
      }
    }
    parts.push({ text: part, block: { index, source: block.source, isDrawn: art !== null, liveUrl } })
    cursor = block.end
  })
  parts.push({ text: text.slice(cursor) })

  return {
    text: parts.map(part => part.text).join(''),
    // 조각 사이의 빈 줄은 조각을 따로 그릴 때의 간격과 겹치므로 덜어 낸다
    parts: parts
      .map((part, order) => (order === 0 ? part : { ...part, text: part.text.replace(/^\s*\n/, '') }))
      .filter(part => part.block !== undefined || part.text.trim() !== ''),
  }
}

function fence(indent: string, language: string, body: string): string {
  const lines = body.split('\n').map(line => indent + line)

  return [indent + '```' + language, ...lines, indent + '```'].join('\n')
}

/** 원문을 편집기에 띄우는 mermaid.live 주소. Link에 담기에 너무 길면 null */
function liveEditorUrl(source: string): string | null {
  const state = JSON.stringify({ code: source, mermaid: '{"theme":"default"}', updateDiagram: true, rough: false })
  const bytes = new TextEncoder().encode(state)
  const base64 = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
  const url = MERMAID_LIVE_URL + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return url.length <= LINK_MAX_LENGTH ? url : null
}
