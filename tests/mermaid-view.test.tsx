import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const FLOWCHART = '```mermaid\nflowchart TD\n  A[주문 생성]\n```'
const ART = [
  '┌───────────┐',
  '│           │',
  '│ 주문 생성 │',
  '│           │',
  '└───────────┘',
].join('\n')

const reply = (text: string, columns = 120) =>
  ({
    plugin: 'mermaid-view',
    component: 'AssistantMessage',
    requestId: 'message-1',
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 40 },
  }) as const

// 엔진 자리: 받은 markdown을 그대로 그린다
const drawMarkdown = (on: On) =>
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)

    return <Markdown text={e.props.text} />
  })

test('다이어그램마다 바로 밑에 원문 버튼을 두고, 누른 다이어그램의 원문만 펼친다', async ($, on) => {
  drawMarkdown(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      ...reply(`첫 번째.\n\n${FLOWCHART}\n\n두 번째.\n\n${FLOWCHART}\n\n끝.`),
      requestId: `message-${surface}`,
      surface,
    })

    const drawn = async () =>
      (await ui.findAll({}))
        .filter(found => found.type === 'Markdown' || found.type === 'Button')
        .map(found => (found.type === 'Button' ? `[${found.key}]` : found.text))

    expect(await drawn()).toEqual([
      `첫 번째.\n\n\`\`\`\n${ART}\n\`\`\``,
      '[source-0]',
      `두 번째.\n\n\`\`\`\n${ART}\n\`\`\``,
      '[source-1]',
      '끝.',
    ])

    await ui.press({ key: 'source-1' })
    expect(await drawn()).toEqual([
      `첫 번째.\n\n\`\`\`\n${ART}\n\`\`\``,
      '[source-0]',
      `두 번째.\n\n\`\`\`\n${ART}\n\`\`\`\n\n${FLOWCHART}`,
      '[source-1]',
      '끝.',
    ])
    expect((await ui.find({ key: 'source-0' }))?.props.label).toBe('▸ show mermaid source')
    expect((await ui.find({ key: 'source-1' }))?.props.label).toBe('▾ hide mermaid source')
    await ui.unmount()
  }
})

test('/mermaid-source 는 모든 원문을 펼치고 버튼을 숨긴다', async ($, on) => {
  drawMarkdown(on)
  on('command.register', () => ({ value: { command: 'mermaid-source' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({
    command: 'mermaid-source',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran.text).toBe('Showing every mermaid source.')

  const ui = await $.ui.mount({ ...reply(FLOWCHART), surface: 'terminal' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(`\`\`\`\n${ART}\n\`\`\`\n\n${FLOWCHART}`)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('mermaid.live 링크에 원문을 담고, 링크에 담기에 너무 긴 원문은 링크를 뺀다', async ($, on) => {
  drawMarkdown(on)
  const long = `flowchart TD\n  A[주문 생성]\n${Array.from({ length: 40 }, (_, i) => `  %% 주문 생성 단계 설명 ${i}`).join('\n')}`
  const ui = await $.ui.mount({
    ...reply(`${FLOWCHART}\n\n\`\`\`mermaid\n${long}\n\`\`\``),
    surface: 'terminal',
  })

  const links = await ui.findAll({ type: 'Link' })
  expect(links).toHaveLength(1)
  const href = links[0]?.props.href as string
  const [base, encoded] = href.split('#base64:')
  const json = new TextDecoder().decode(
    Uint8Array.from(atob(encoded!.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)),
  )
  expect(base).toBe('https://mermaid.live/edit')
  expect(JSON.parse(json).code).toBe('flowchart TD\n  A[주문 생성]')
  expect(await ui.find({ key: 'source-1' })).toBeDefined()
  await ui.unmount()
})

test('인용문 안의 블록도 인용문 표시를 유지한 채 그린다', async ($, on) => {
  drawMarkdown(on)
  const quoted = '> 설명.\n>\n> ```mermaid\n> flowchart TD\n>   A[주문 생성]\n> ```'
  const ui = await $.ui.mount({ ...reply(quoted), surface: 'terminal' })

  const quotedArt = ART.split('\n').map(line => `> ${line}`)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(
    ['> 설명.', '>', '> ```', ...quotedArt, '> ```'].join('\n'),
  )

  await ui.press({ key: 'source-0' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(
    ['> 설명.', '>', '> ```', ...quotedArt, '> ```', '>', '> ```mermaid', '> flowchart TD', '>   A[주문 생성]', '> ```'].join(
      '\n',
    ),
  )
  await ui.unmount()
})

test('이모지도 한글처럼 2칸으로 맞춰 그린다', async ($, on) => {
  drawMarkdown(on)
  const ui = await $.ui.mount({ ...reply('```mermaid\nflowchart LR\n  A[✅] --> B[😀]\n```'), surface: 'terminal' })

  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(
    [
      '```',
      '┌────┐     ┌────┐',
      '│    │     │    │',
      '│ ✅ ├────►│ 😀 │',
      '│    │     │    │',
      '└────┘     └────┘',
      '```',
    ].join('\n'),
  )
  await ui.unmount()
})

test('기본 간격으로 화면보다 넓은 flowchart는 좁은 간격으로 다시 그린다', async ($, on) => {
  drawMarkdown(on)
  const ui = await $.ui.mount({
    ...reply('```mermaid\nflowchart LR\n  A[주문] --> B[결제]\n```', 20),
    surface: 'terminal',
  })

  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(
    ['```', '┌────┐  ┌────┐', '│주문├─►│결제│', '└────┘  └────┘', '```'].join('\n'),
  )
  await ui.unmount()
})

test('화면보다 넓은 sequence 다이어그램은 들어가는 가장 긴 줄 길이로 라벨을 줄바꿈해 그린다', async ($, on) => {
  drawMarkdown(on)
  const ui = await $.ui.mount({
    ...reply('```mermaid\nsequenceDiagram\n  A->>B: 주문 목록을 최근 90일 기준으로 조회한다\n```', 50),
    surface: 'terminal',
  })

  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(
    [
      '```',
      ' ┌───┐                               ┌───┐',
      ' │ A │                               │ B │',
      ' └─┬─┘                               └─┬─┘',
      '   │                                   │',
      '   │  주문 목록을 최근 90일 기준으로   │',
      '   │             조회한다              │',
      '   │───────────────────────────────────▶',
      '   │                                   │',
      ' ┌─┴─┐                               ┌─┴─┐',
      ' │ A │                               │ B │',
      ' └───┘                               └───┘',
      '```',
    ].join('\n'),
  )
  await ui.unmount()
})

test('참가자 박스 높이가 달라도 생명선은 각 박스 바로 밑에서 시작한다', async ($, on) => {
  drawMarkdown(on)
  const ui = await $.ui.mount({
    ...reply('```mermaid\nsequenceDiagram\n  participant A as 주문<br>서버\n  A->>B: 조회\n```'),
    surface: 'terminal',
  })

  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(
    [
      '```',
      '┌──────┐    ┌───┐',
      '│ 주문 │    │ B │',
      '│ 서버 │    └─┬─┘',
      '└───┬──┘      │',
      '    │         │',
      '    │  조회   │',
      '    │─────────▶',
      '    │         │',
      '┌───┴──┐    ┌─┴─┐',
      '│ 주문 │    │ B │',
      '│ 서버 │    └───┘',
      '└──────┘',
      '```',
    ].join('\n'),
  )
  await ui.unmount()
})

test('변환할 수 없거나 아직 닫히지 않았거나 화면보다 넓으면 원문 그대로 둔다', async ($, on) => {
  drawMarkdown(on)
  const cases = [
    reply('```mermaid\npie\n  "a": 1\n```'),
    reply('```mermaid\nflowchart TD\n  A[주문 생성]'),
    reply('```mermaid\nflowchart LR\n  A[아주 긴 라벨 하나] --> B[아주 긴 라벨 둘]\n```', 30),
  ]

  for (const target of cases) {
    const ui = await $.ui.mount({ ...target, surface: 'terminal' })
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(target.props.text)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('다이어그램 뒤 조각은 첫 조각의 본문 칸에 맞춰 들인다', async ($, on) => {
  drawMarkdown(on)
  const text = `앞.\n\n${FLOWCHART}\n\n끝.`

  for (const [isFirstOfReply, paddingLeft] of [
    [true, 2],
    [false, 0],
  ] as const) {
    const target = reply(text)
    const ui = await $.ui.mount({ ...target, props: { ...target.props, isFirstOfReply }, surface: 'terminal' })
    const rest = (await ui.findAll({ type: 'Box', text: '끝.' })).find(box => box.text === '끝.')
    expect(rest?.props.paddingLeft).toBe(paddingLeft)
    await ui.unmount()
  }
})
