export interface SseMessage {
  event?: string
  data: string
}

/** 将任意网络分块稳定解码为 SSE 消息，兼容 CRLF 和跨块 UTF-8 字符。 */
export async function* decodeSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const message = parseBlock(block)
        if (message) yield message
        boundary = buffer.indexOf('\n\n')
      }
      if (done) break
    }
    const finalMessage = parseBlock(buffer)
    if (finalMessage) yield finalMessage
  } finally {
    reader.releaseLock()
  }
}

function parseBlock(block: string): SseMessage | null {
  let event: string | undefined
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null
}
