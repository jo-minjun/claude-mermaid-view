import { atom, memberOf, read, update } from 'claude-code'
import type { Register, RenderSurface } from 'claude-code'

import { rewriteMermaid } from './mermaid'

const SOURCE_COMMAND = 'mermaid-source'
const PROMPT_COMMAND = 'mermaid-prompt'
// 세션이 바뀌어도 유지하려고 $.state 대신 $.store에 둔다. 값이 없으면 켜진 것으로 본다
const PROMPT_STORE_KEY = 'isPromptOn'
const PROMPT_SECTION = {
  id: 'mermaid-view:diagrams',
  text: [
    'When you draw a diagram in a reply, write it as a ```mermaid code block instead of ASCII art: this session draws mermaid blocks as text diagrams in the terminal.',
    'Use flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2 or xychart-beta; other diagram types stay as source.',
    'Keep labels and participant names short. Flowchart node ids must be ASCII; labels may be in any language.',
    "The user's own instructions about diagrams come first.",
  ].join(' '),
  scope: 'session',
} as const
// 답변 앞 글머리(● )와 코드 블록 들여쓰기가 차지하는 칸
const REPLY_GUTTER_COLUMNS = 4
// 터미널이 답변 본문을 글머리 뒤로 들이는 칸
const REPLY_TEXT_INDENT = 2

const openSources = atom({ plugin: 'mermaid-view', key: 'openSources' } as const, [])
const showAllSources = atom({ plugin: 'mermaid-view', key: 'showAllSources' } as const, false)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: SOURCE_COMMAND,
      description: 'Show or fold the mermaid source under every diagram',
    })
    await $.command.register({
      name: PROMPT_COMMAND,
      description: 'Turn on or off asking Claude to draw diagrams as mermaid',
    })

    return next(e)
  })

  on('command.run', { command: SOURCE_COMMAND }, async $ => {
    const isShown = await update($, showAllSources, shown => !shown)

    return { text: isShown ? 'Showing every mermaid source.' : 'Folded every mermaid source.' }
  })

  on('command.run', { command: PROMPT_COMMAND }, async $ => {
    const isOn = (await $.store.get(PROMPT_STORE_KEY)) === false
    await $.store.set(PROMPT_STORE_KEY, isOn)

    return {
      text: isOn
        ? 'Asking Claude to draw diagrams as mermaid, from the next message.'
        : 'Stopped asking Claude to draw diagrams as mermaid, from the next message.',
    }
  })

  // 다이어그램을 그려 줄 화면이 없는 요청(헤드리스 등)에는 지시를 넣지 않는다
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.surfaces.length === 0 || (await $.store.get(PROMPT_STORE_KEY)) === false) {
      return composed
    }

    return { sections: [...composed.sections, PROMPT_SECTION] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || !e.props.text.includes('mermaid')) {
      return next(e)
    }

    const member = memberOf(openSources, e)
    const open = await read($, member)
    const isAllShown = await read($, showAllSources)
    const columns = e.viewport?.columns
    const { text, parts } = rewriteMermaid(e.props.text, {
      maxColumns: columns === undefined ? undefined : columns - REPLY_GUTTER_COLUMNS,
      isSourceOpen: index => isAllShown || open.includes(index),
    })
    if (parts.every(part => part.block === undefined)) {
      return next(e)
    }
    if (isAllShown) {
      return next({ ...e, props: { ...e.props, text } })
    }

    // 버튼과 링크를 각 블록 바로 밑에 두려고 조각마다 엔진의 답변 렌더러로 그린다.
    // 글머리(●)는 첫 조각에만 남긴다.
    const drawn = await Promise.all(
      parts.map((part, order) =>
        next({
          ...e,
          props: { ...e.props, text: part.text, isFirstOfReply: e.props.isFirstOfReply && order === 0 },
        }),
      ),
    )

    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const indent = e.surface === 'terminal' ? REPLY_TEXT_INDENT : 0
    // 엔진은 글머리를 뺀 조각을 본문 들여쓰기 없이 그리므로, 첫 조각의 본문 칸에 맞춰 들인다
    const continuationIndent = e.props.isFirstOfReply ? indent : 0
    const toggle = (index: number) =>
      update($, member, list =>
        list.includes(index) ? list.filter(one => one !== index) : [...list, index],
      )
    const copy = async (source: string, surface: RenderSurface) => {
      const { isCopied } = await $.ui.copy({ text: source, surface })
      $.ui.toast(isCopied ? 'Copied mermaid source.' : "Couldn't copy mermaid source.")
    }

    return (
      <Box flexDirection="column">
        {parts.flatMap(({ block }, order) => {
          const part = order === 0 ? drawn[order] : <Box paddingLeft={continuationIndent}>{drawn[order]}</Box>
          if (block === undefined) {
            return [part]
          }

          // 그리지 못한 블록은 원문이 이미 보이므로 펼치는 버튼을 달지 않는다
          const actions = [
            block.isDrawn && (
              <Button
                key={`source-${block.index}`}
                plain
                dimColor
                label={open.includes(block.index) ? '▾ hide mermaid source' : '▸ show mermaid source'}
                onPress={() => toggle(block.index)}
              />
            ),
            <Button
              key={`copy-${block.index}`}
              plain
              dimColor
              label="copy source"
              onPress={press => copy(block.source, press.surface)}
            />,
            block.liveUrl !== undefined && (
              <Text dimColor>
                <Link href={block.liveUrl} label="open in mermaid.live" />
              </Text>
            ),
          ].filter(action => action !== false)

          return [
            part,
            <Box paddingLeft={indent}>
              {actions.flatMap((action, at) => (at === 0 ? [action] : [<Text dimColor>{'  ·  '}</Text>, action]))}
            </Box>,
          ]
        })}
      </Box>
    )
  })
}
