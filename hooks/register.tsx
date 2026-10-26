import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { rewriteMermaid } from './mermaid'

const COMMAND = 'mermaid-source'
// 답변 앞 글머리(● )와 코드 블록 들여쓰기가 차지하는 칸
const REPLY_GUTTER_COLUMNS = 4

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

    return { text: isShown ? 'mermaid 원문을 모두 펼쳤어요.' : 'mermaid 원문을 다시 접었어요.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || !e.props.text.includes('mermaid')) {
      return next(e)
    }

    const member = memberOf(openSources, e)
    const open = await read($, member)
    const isAllShown = await read($, showAllSources)
    const columns = e.viewport?.columns
    const { text, rendered } = rewriteMermaid(e.props.text, {
      maxColumns: columns === undefined ? undefined : columns - REPLY_GUTTER_COLUMNS,
      isSourceOpen: index => isAllShown || open.includes(index),
    })
    if (rendered.length === 0) {
      return next(e)
    }

    const drawn = await next({ ...e, props: { ...e.props, text } })
    if (isAllShown) {
      return drawn
    }

    const { Box, Button } = $.ui.resolve(e)
    const toggle = (index: number) =>
      update($, member, list =>
        list.includes(index) ? list.filter(one => one !== index) : [...list, index],
      )

    return (
      <Box flexDirection="column">
        {drawn}
        <Box columnGap={2}>
          {rendered.map((index, order) => (
            <Button
              key={`source-${index}`}
              plain
              dimColor
              label={sourceLabel(open.includes(index), rendered.length > 1 ? order + 1 : undefined)}
              onPress={() => toggle(index)}
            />
          ))}
        </Box>
      </Box>
    )
  })
}

function sourceLabel(isOpen: boolean, number: number | undefined): string {
  const name = number === undefined ? 'mermaid 원문' : `mermaid 원문 ${number}`

  return isOpen ? `▾ ${name} 접기` : `▸ ${name} 보기`
}
