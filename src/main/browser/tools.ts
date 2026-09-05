import { z } from 'zod'
import type { ContentPart } from '@core/events'
import { ToolRegistry } from '@core/tools/registry'
import type { ToolContext, ToolDefinition, ToolResult } from '@core/tools/types'
import type { BrowserAutomation } from './types'

type InputRecord = Record<string, unknown>
const OBJECT_SCHEMA = { type: 'object', additionalProperties: false } as const

export function registerBrowserTools(registry: ToolRegistry, browser: BrowserAutomation): void {
  const register = (
    def: ToolDefinition,
    execute: (input: InputRecord, context: ToolContext) => Promise<ToolResult>
  ): void => registry.register(def, (input, context) => execute(input as InputRecord, context))

  register(
    definition(
      'browser_navigate',
      '在可视化内置浏览器中打开 HTTP(S) 网页；可在当前标签或新标签导航。',
      true,
      'BrowserNavigate',
      z.object({ url: z.string().min(1).max(8192), tabId: z.string().min(1).optional(), newTab: z.boolean().optional() }),
      { ...OBJECT_SCHEMA, properties: { url: { type: 'string' }, tabId: { type: 'string' }, newTab: { type: 'boolean' } }, required: ['url'] }
    ),
    async (input, context) => {
      const tab = await browser.navigate({ sessionId: context.sessionId, workspacePath: context.workspacePath, url: String(input.url), tabId: stringValue(input.tabId), newTab: input.newTab === true })
      return externalResult(`已导航到 ${tab.url}\n标题：${tab.title || '加载中'}\n标签：${tab.id}`, tab)
    }
  )

  register(
    definition(
      'browser_click',
      '点击页面元素。优先传入页面快照给出的 CSS selector，也可传入视口坐标。',
      false,
      'BrowserClick',
      z.object({
        tabId: z.string().min(1).optional(),
        selector: z.string().min(1).max(2048).optional(),
        x: z.number().finite().min(0).optional(),
        y: z.number().finite().min(0).optional(),
        button: z.enum(['left', 'middle', 'right']).optional(),
        clickCount: z.number().int().min(1).max(3).optional()
      }),
      {
        ...OBJECT_SCHEMA,
        properties: {
          tabId: { type: 'string' }, selector: { type: 'string' }, x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 },
          button: { type: 'string', enum: ['left', 'middle', 'right'] }, clickCount: { type: 'integer', minimum: 1, maximum: 3 }
        }
      },
      1
    ),
    async (input, context) => {
      const result = await browser.click({
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        tabId: stringValue(input.tabId),
        selector: stringValue(input.selector),
        x: numberValue(input.x),
        y: numberValue(input.y),
        button: input.button as 'left' | 'middle' | 'right' | undefined,
        clickCount: numberValue(input.clickCount)
      })
      return externalResult(`已点击页面位置 (${Math.round(result.x)}, ${Math.round(result.y)})${result.selector ? `：${result.selector}` : ''}`, result)
    }
  )

  register(
    definition(
      'browser_type',
      '向页面输入框、文本域或可编辑元素输入文本，可先清空并可提交 Enter。',
      false,
      'BrowserType',
      z.object({ tabId: z.string().min(1).optional(), selector: z.string().min(1).max(2048), text: z.string().max(100_000), clear: z.boolean().optional(), submit: z.boolean().optional() }),
      {
        ...OBJECT_SCHEMA,
        properties: { tabId: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' }, clear: { type: 'boolean' }, submit: { type: 'boolean' } },
        required: ['selector', 'text']
      },
      1
    ),
    async (input, context) => {
      const result = await browser.type({
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        tabId: stringValue(input.tabId),
        selector: String(input.selector),
        text: String(input.text),
        clear: input.clear !== false,
        submit: input.submit === true
      })
      return externalResult(`已向 ${result.selector} 输入 ${result.characters} 个字符${result.submitted ? '并提交' : ''}`, result)
    }
  )

  register(
    definition(
      'browser_scroll',
      '滚动页面或指定可滚动元素，deltaX/deltaY 使用 CSS 像素。',
      true,
      'BrowserScroll',
      z.object({ tabId: z.string().min(1).optional(), selector: z.string().min(1).max(2048).optional(), deltaX: z.number().finite().min(-100_000).max(100_000).optional(), deltaY: z.number().finite().min(-100_000).max(100_000).optional() }),
      {
        ...OBJECT_SCHEMA,
        properties: { tabId: { type: 'string' }, selector: { type: 'string' }, deltaX: { type: 'number' }, deltaY: { type: 'number' } }
      }
    ),
    async (input, context) => {
      const result = await browser.scroll({
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        tabId: stringValue(input.tabId),
        selector: stringValue(input.selector),
        deltaX: numberValue(input.deltaX) ?? 0,
        deltaY: numberValue(input.deltaY) ?? 600
      })
      return externalResult(`滚动完成，当前位置 x=${Math.round(result.x)} y=${Math.round(result.y)}`, result)
    }
  )

  const snapshotDefinition = (fullName: 'browser_snapshot' | 'browser_extract'): ToolDefinition => definition(
    fullName,
    fullName === 'browser_extract'
      ? '提取当前网页的可见文本、标题、链接及可交互元素并转换为 Markdown。'
      : '通过 Chrome DevTools Protocol DOMSnapshot 获取当前网页的可见内容与可交互元素。',
    true,
    fullName === 'browser_extract' ? 'BrowserExtract' : 'BrowserSnapshot',
    z.object({ tabId: z.string().min(1).optional(), maxChars: z.number().int().min(1000).max(200_000).optional() }),
    { ...OBJECT_SCHEMA, properties: { tabId: { type: 'string' }, maxChars: { type: 'integer', minimum: 1000, maximum: 200000 } } }
  )
  for (const fullName of ['browser_snapshot', 'browser_extract'] as const) {
    register(snapshotDefinition(fullName), async (input, context) => {
      const result = await browser.snapshot({ sessionId: context.sessionId, workspacePath: context.workspacePath, tabId: stringValue(input.tabId), maxChars: numberValue(input.maxChars) })
      return { content: result.markdown || '[页面没有可提取的可见内容]', data: result, truncated: result.truncated, untrusted: true }
    })
  }

  register(
    definition(
      'browser_screenshot',
      '截取当前浏览器标签并保存为工作区 PNG；可截取完整页面。',
      true,
      'BrowserScreenshot',
      z.object({ tabId: z.string().min(1).optional(), path: z.string().min(1).max(4096).optional(), fullPage: z.boolean().optional() }),
      { ...OBJECT_SCHEMA, properties: { tabId: { type: 'string' }, path: { type: 'string' }, fullPage: { type: 'boolean' } } }
    ),
    async (input, context) => {
      const result = await browser.screenshot({
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        grantedRoots: context.grantedRoots,
        tabId: stringValue(input.tabId),
        path: stringValue(input.path),
        fullPage: input.fullPage === true
      })
      return externalResult(`浏览器截图已保存：${result.path}\n尺寸：${result.width}×${result.height}，${result.bytes} 字节`, result, [
        { kind: 'image', source: result.path, mimeType: 'image/png' }
      ])
    }
  )

  register(
    definition(
      'browser_download',
      '使用当前浏览器登录态下载 HTTP(S) 资源到工作区或显式授权目录。页面自行发起的下载默认被拦截。',
      false,
      'BrowserDownload',
      z.object({ tabId: z.string().min(1).optional(), url: z.string().min(1).max(8192), path: z.string().min(1).max(4096), overwrite: z.boolean().optional() }),
      { ...OBJECT_SCHEMA, properties: { tabId: { type: 'string' }, url: { type: 'string' }, path: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['url', 'path'] },
      2
    ),
    async (input, context) => {
      const result = await browser.download({
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        grantedRoots: context.grantedRoots,
        tabId: stringValue(input.tabId),
        url: String(input.url),
        path: String(input.path),
        overwrite: input.overwrite === true,
        signal: context.signal
      })
      return externalResult(`下载完成：${result.path}\n大小：${result.bytes} 字节\n来源：${result.url}`, result)
    }
  )

  register(
    definition(
      'browser_upload',
      '把工作区或显式授权目录中的文件设置到网页 file input；需要 CSS selector。',
      false,
      'BrowserUpload',
      z.object({ tabId: z.string().min(1).optional(), selector: z.string().min(1).max(2048), paths: z.array(z.string().min(1).max(4096)).min(1).max(20) }),
      {
        ...OBJECT_SCHEMA,
        properties: { tabId: { type: 'string' }, selector: { type: 'string' }, paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 } },
        required: ['selector', 'paths']
      },
      2
    ),
    async (input, context) => {
      const result = await browser.upload({
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        grantedRoots: context.grantedRoots,
        tabId: stringValue(input.tabId),
        selector: String(input.selector),
        paths: input.paths as string[]
      })
      return externalResult(`已向 ${result.selector} 选择 ${result.paths.length} 个文件`, result)
    }
  )
}

function definition(
  fullName: string,
  description: string,
  readOnly: boolean,
  semanticLabel: string,
  inputSchema: ToolDefinition['inputSchema'],
  inputJsonSchema: ToolDefinition['inputJsonSchema'],
  dangerLevel: 0 | 1 | 2 = 0
): ToolDefinition {
  return { name: fullName, fullName, description, kind: 'browser', readOnly, semanticLabel, inputSchema, inputJsonSchema, dangerLevel, source: 'builtin' }
}

function externalResult(content: string, data: unknown, attachments?: ContentPart[]): ToolResult {
  return { content, data: data as ToolResult['data'], untrusted: true, ...(attachments?.length ? { attachments } : {}) }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
