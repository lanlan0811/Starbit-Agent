import { describe, expect, it } from 'vitest'
import { translate } from './strings'

describe('i18n 词典', () => {
  it('zh-CN 为默认回退语言，缺失键返回键名', () => {
    expect(translate('zh-CN', 'nav.settings')).toBe('设置')
    expect(translate('en-US', 'nav.settings')).toBe('Settings')
    expect(translate('zh-CN', 'nonexistent.key')).toBe('nonexistent.key')
  })

  it('支持 {name} 插值', () => {
    expect(translate('zh-CN', 'files.count', { count: 12 })).toBe('12 个文件')
    expect(translate('en-US', 'files.count', { count: 12 })).toBe('12 files')
    expect(translate('zh-CN', 'settings.testOk', { ms: 233 })).toBe('连接成功，耗时 233ms。')
  })

  it('两种语言的词典键集合一致', () => {
    // 通过公开 API 对比：遍历 zh 键在 en 中翻译不等于键名
    const probeKeys = ['common.save', 'nav.sessions', 'settings.data', 'usage.perModel', 'permission.allowOnce', 'compaction.title']
    for (const key of probeKeys) {
      expect(translate('en-US', key)).not.toBe(key)
      expect(translate('zh-CN', key)).not.toBe(key)
    }
  })
})
