import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolResult } from '@core/tools/types'

const DEFAULT_MAX_BYTES = 64 * 1024

export async function limitToolOutput(
  content: string,
  workspacePath: string,
  toolCallId: string,
  maxBytes = DEFAULT_MAX_BYTES
): Promise<ToolResult> {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes <= maxBytes) return { content, truncated: false }

  const outputDir = join(workspacePath, '.starbit', 'tool-output')
  await mkdir(outputDir, { recursive: true })
  const outputFile = join(outputDir, `${safeFileName(toolCallId)}.txt`)
  await writeFile(outputFile, content, 'utf8')
  const head = content.slice(0, Math.floor(maxBytes * 0.7))
  const tail = content.slice(-Math.floor(maxBytes * 0.2))
  return {
    content: `${head}\n\n… 输出已截断，完整结果: ${outputFile} …\n\n${tail}`,
    truncated: true,
    outputFile
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}
