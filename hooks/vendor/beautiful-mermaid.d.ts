export type AsciiRenderOptions = {
  useAscii?: boolean
  paddingX?: number
  paddingY?: number
  boxBorderPadding?: number
  colorMode?: 'none' | 'auto' | 'ansi16' | 'ansi256' | 'truecolor' | 'html'
}

export declare function renderMermaidASCII(text: string, options?: AsciiRenderOptions): string
