import { isIP } from 'node:net'

export const ALLOWED_BROWSER_PROTOCOLS = new Set(['http:', 'https:'])

export interface BrowserUrlOptions {
  searchUrlTemplate?: string
  allowCredentials?: boolean
}

/** 把地址栏输入转换为受控 HTTP(S) URL；其他协议一律拒绝。 */
export function normalizeBrowserUrl(input: string, options: BrowserUrlOptions = {}): string {
  const value = input.trim()
  if (!value) throw new Error('浏览器地址不能为空')

  let candidate = value
  if (!hasScheme(candidate)) {
    candidate = looksLikeHost(candidate)
      ? `https://${candidate}`
      : applySearchTemplate(options.searchUrlTemplate, candidate)
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error(`浏览器地址无效: ${value}`)
  }
  if (!ALLOWED_BROWSER_PROTOCOLS.has(url.protocol)) {
    throw new Error(`浏览器仅允许 HTTP(S) 地址，已拒绝 ${url.protocol}`)
  }
  if (!url.hostname) throw new Error('浏览器地址缺少主机名')
  if (!options.allowCredentials && (url.username || url.password)) {
    throw new Error('浏览器地址不得包含明文用户名或密码')
  }
  return url.toString()
}

export function isAllowedBrowserUrl(input: string): boolean {
  try {
    normalizeBrowserUrl(input)
    return true
  } catch {
    return false
  }
}

export function isPrivateNetworkUrl(input: string): boolean {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  const version = isIP(hostname)
  if (version === 4) {
    const [a, b] = hostname.split('.').map(Number)
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (version === 6) return hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')
  return false
}

function hasScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value)
}

function looksLikeHost(value: string): boolean {
  const first = value.split(/[/?#]/, 1)[0]
  return first === 'localhost' || first.includes('.') || isIP(first.replace(/^\[|\]$/g, '')) !== 0
}

function applySearchTemplate(template: string | undefined, query: string): string {
  if (!template) throw new Error('请输入完整的网址（例如 https://example.com）')
  if (!template.includes('{query}')) throw new Error('浏览器搜索地址模板必须包含 {query}')
  return template.replace('{query}', encodeURIComponent(query))
}
