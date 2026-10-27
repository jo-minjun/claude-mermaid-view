import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { rewriteMermaid } from './mermaid'

const COMMAND = 'mermaid-source'
// 답변 앞 글머리(● )와 코드 블록 들여쓰기가 차지하는 칸
const REPLY_GUTTER_COLUMNS = 4
// 터미널이 답변 본문을 글머리 뒤로 들이는 칸
const REPLY_TEXT_INDENT = 2

const openSources = atom({ plugin: 'mermaid-view', key: 'openSources' } as const, [])
const showAllSources = atom({ plugin: 'mermaid-view', key: 'showAllSources' } as const, false)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or fold the mermaid source under every diagram',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const isShown = await update($, showAllSources, shown => !shown)

    return { text: isShown ? 'Showing every mermaid source.' : 'Folded every mermaid source.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || !e.props.text.includes('mermaid')) {
      return next(e)
    }

    const member = memberOf(openSources, e)
    const open = await read($, member)
    const isAllShown = await read($, showAllSources)
    const columns = e.viewport?.columns
    const { text, parts, rendered } = rewriteMermaid(e.props.text, {
      maxColumns: columns === undefined ? undefined : columns - REPLY_GUTTER_COLUMNS,
      isSourceOpen: index => isAllShown || open.includes(index),
    })
    if (rendered.length === 0) {
      return next(e)
    }
    if (isAllShown) {
      return next({ ...e, props: { ...e.props, text } })
    }

    // 버튼을 각 다이어그램 바로 밑에 두려고 조각마다 엔진의 답변 렌더러로 그린다.
    // 글머리(●)는 첫 조각에만 남긴다.
    const drawn = await Promise.all(
      parts.map((part, order) =>
        next({
          ...e,
          props: { ...e.props, text: part.text, isFirstOfReply: e.props.isFirstOfReply && order === 0 },
        }),
      ),
    )

    const { Box, Button } = $.ui.resolve(e)
    const indent = e.surface === 'terminal' ? REPLY_TEXT_INDENT : 0
    // 엔진은 글머리를 뺀 조각을 본문 들여쓰기 없이 그리므로, 첫 조각의 본문 칸에 맞춰 들인다
    const continuationIndent = e.props.isFirstOfReply ? indent : 0
    const toggle = (index: number) =>
      update($, member, list =>
        list.includes(index) ? list.filter(one => one !== index) : [...list, index],
      )

    return (
      <Box flexDirection="column">
        {parts.flatMap(({ diagram }, order) => {
          const part = order === 0 ? drawn[order] : <Box paddingLeft={continuationIndent}>{drawn[order]}</Box>

          return diagram === undefined
            ? [part]
            : [
                part,
                <Box paddingLeft={indent}>
                  <Button
                    key={`source-${diagram}`}
                    plain
                    dimColor
                    label={open.includes(diagram) ? '▾ hide mermaid source' : '▸ show mermaid source'}
                    onPress={() => toggle(diagram)}
                  />
                </Box>,
              ]
        })}
      </Box>
    )
  })
}
