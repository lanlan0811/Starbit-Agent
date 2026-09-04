import { safeStorage } from 'electron'
import { getSetting, setSetting } from '../session/database'

export interface SecretStore {
  encrypt(value: string): string
  decrypt(value: string): string
}

class ElectronSecretStore implements SecretStore {
  encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭证加密当前不可用')
    return safeStorage.encryptString(value).toString('base64')
  }

  decrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭证加密当前不可用')
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
}

/** 设置值使用 SQLite，密钥值先经 Electron safeStorage 加密。 */
export class SettingsService {
  constructor(private readonly secrets: SecretStore = new ElectronSecretStore()) {}

  getString(key: string, fallback = ''): string {
    return getSetting(`setting:${key}`) ?? fallback
  }

  setString(key: string, value: string): void {
    setSetting(`setting:${key}`, value)
  }

  getJson<T>(key: string, fallback: T): T {
    const value = getSetting(`setting:${key}`)
    if (!value) return fallback
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  setJson(key: string, value: unknown): void {
    setSetting(`setting:${key}`, JSON.stringify(value))
  }

  setSecret(key: string, value: string): void {
    setSetting(`secret:${key}`, value ? this.secrets.encrypt(value) : '')
  }

  getSecret(key: string): string {
    const encrypted = getSetting(`secret:${key}`)
    if (!encrypted) return ''
    return this.secrets.decrypt(encrypted)
  }

  hasSecret(key: string): boolean {
    return Boolean(getSetting(`secret:${key}`))
  }
}
