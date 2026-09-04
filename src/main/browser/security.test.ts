import { describe, expect, it } from 'vitest'
import { isPrivateNetworkUrl, normalizeBrowserUrl } from './security'

describe('browser URL security', () => {
  it('只接受 HTTP(S)，并拒绝地址中的明文凭据', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/')
    expect(() => normalizeBrowserUrl('file:///C:/secret.txt')).toThrow('仅允许 HTTP(S)')
    expect(() => normalizeBrowserUrl('https://user:password@example.com')).toThrow('明文用户名或密码')
  })

  it('识别常见本机与私有网络地址', () => {
    expect(isPrivateNetworkUrl('http://localhost')).toBe(true)
    expect(isPrivateNetworkUrl('http://127.0.0.1')).toBe(true)
    expect(isPrivateNetworkUrl('http://10.2.3.4')).toBe(true)
    expect(isPrivateNetworkUrl('http://192.168.1.10')).toBe(true)
    expect(isPrivateNetworkUrl('https://example.com')).toBe(false)
  })

  it('仅在配置搜索模板后将文本转成搜索 URL', () => {
    expect(() => normalizeBrowserUrl('测试查询')).toThrow('完整的网址')
    expect(normalizeBrowserUrl('测试查询', { searchUrlTemplate: 'https://search.example/?q={query}' })).toContain('%E6%B5%8B%E8%AF%95')
  })
})
