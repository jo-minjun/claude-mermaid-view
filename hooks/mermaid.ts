import { renderMermaidASCII } from './vendor/beautiful-mermaid.js'

export type MermaidBlock = {
  start: number
  end: number
  indent: string
  source: string
}

export type RewriteResult = {
  text: string
  /** 다이어그램으로 바뀐 블록의 순번(메시지 안에서 0부터) */
  rendered: number[]
}

const MERMAID_FENCE =
  /^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\2[ \t]*$/gm

// 터미널에서 2칸을 차지하는 글자: 한글, CJK, 전각 기호, 이모지
const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1F300}-\u{1FAFF}]/gu

// 렌더러는 모든 글자를 1칸으로 계산하므로, 넓은 글자 뒤에 1칸짜리 채움 글자를 붙여
// 자리를 잡게 한 뒤 출력에서 지운다. state 다이어그램의 이름이 \p{L} 만 받아서
// 채움 글자도 문자(Lisu, U+A4D0)여야 하고, 실제 다이어그램에 나올 일이 거의 없는 것을 고른다.
const WIDTH_PAD = 'ꓐ'

const CACHE_LIMIT = 64
const cache = new Map<string, string | null>()

export function findMermaidBlocks(text: string): MermaidBlock[] {
  return [...text.matchAll(MERMAID_FENCE)].map(match => {
    const indent = match[1] ?? ''
    const source = (match[3] ?? '')
      .split('\n')
      .map(line => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join('\n')

    return { start: match.index, end: match.index + match[0].length, indent, source }
  })
}

export function displayWidth(line: string): number {
  return [...line].length + (line.match(WIDE_CHAR)?.length ?? 0)
}

export function renderDiagram(source: string): string | null {
  const cached = cache.get(source)
  if (cached !== undefined) {
    return cached
  }

  const art = renderUncached(source)
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(source, art)

  return art
}

function renderUncached(source: string): string | null {
  try {
    const padded = source.replace(WIDE_CHAR, char => char + WIDTH_PAD)
    const art = renderMermaidASCII(padded, { colorMode: 'none' })
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
 * mermaid 블록을 텍스트 다이어그램 코드 블록으로 바꾼다. 변환에 실패했거나
 * `maxColumns`보다 넓은 블록은 원문 그대로 둔다.
 */
export function rewriteMermaid(
  text: string,
  options: { maxColumns?: number; isSourceOpen: (index: number) => boolean },
): RewriteResult {
  const blocks = findMermaidBlocks(text)
  const rendered: number[] = []
  let out = ''
  let cursor = 0

  blocks.forEach((block, index) => {
    const art = renderDiagram(block.source)
    const fits =
      art !== null &&
      (options.maxColumns === undefined ||
        Math.max(...art.split('\n').map(displayWidth)) <= options.maxColumns)
    if (!fits) {
      return
    }

    rendered.push(index)
    out += text.slice(cursor, block.start) + fence(block.indent, '', art)
    if (options.isSourceOpen(index)) {
      out += '\n\n' + fence(block.indent, 'mermaid', block.source)
    }
    cursor = block.end
  })

  return { text: out + text.slice(cursor), rendered }
}

function fence(indent: string, language: string, body: string): string {
  const lines = body.split('\n').map(line => indent + line)

  return [indent + '```' + language, ...lines, indent + '```'].join('\n')
}
