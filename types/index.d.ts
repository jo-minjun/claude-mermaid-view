declare module 'claude-code' {
  interface PluginState {
    'mermaid-view': {
      // 메시지(requestId)별로 원문을 펼친 다이어그램의 순번
      openSources: StateFamily<number[]>
      showAllSources: boolean
    }
  }
}
