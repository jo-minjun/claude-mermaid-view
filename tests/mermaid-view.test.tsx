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

test('한글 라벨 다이어그램을 정렬된 텍스트로 그리고 원문은 버튼으로 펼친다', async ($, on) => {
  drawMarkdown(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      ...reply(`순서는 다음과 같아요.\n\n${FLOWCHART}\n\n끝.`),
      requestId: `message-${surface}`,
      surface,
    })

    const folded = await ui.find({ type: 'Markdown' })
    expect(folded?.text).toBe(`순서는 다음과 같아요.\n\n\`\`\`\n${ART}\n\`\`\`\n\n끝.`)

    await ui.press({ key: 'source-0' })
    const opened = await ui.find({ type: 'Markdown' })
    expect(opened?.text).toContain(`\`\`\`\n\n${FLOWCHART}`)
    expect((await ui.find({ key: 'source-0' }))?.props.label).toBe('▾ mermaid 원문 접기')
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
  expect(ran.text).toBe('mermaid 원문을 모두 펼쳤어요.')

  const ui = await $.ui.mount({ ...reply(FLOWCHART), surface: 'terminal' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(`\`\`\`\n${ART}\n\`\`\`\n\n${FLOWCHART}`)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
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
