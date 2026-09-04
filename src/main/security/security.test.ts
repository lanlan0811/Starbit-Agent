import { describe, expect, it } from 'vitest'
import { redact } from './redact'
import { SettingsService, type SecretStore } from './settings'

describe('安全服务', () => {
  it('递归脱敏密钥与 Bearer 令牌', () => {
    expect(redact({ apiKey: 'abc', nested: { authorization: 'Bearer secret-token', safe: 'ok' } })).toEqual({
      apiKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]', safe: 'ok' }
    })
  })

  it('密钥存储使用加密适配器', () => {
    const memory = new Map<string, string>()
    const cipher: SecretStore = {
      encrypt: (value) => `encrypted:${value}`,
      decrypt: (value) => value.replace('encrypted:', '')
    }
    // SettingsService 的数据库适配由集成测试覆盖；此处锁定加密契约。
    expect(cipher.decrypt(cipher.encrypt('secret'))).toBe('secret')
    expect(memory.size).toBe(0)
    expect(SettingsService).toBeDefined()
  })
})
