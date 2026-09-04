const SENSITIVE_KEY = /(api[-_]?key|authorization|password|secret|token)/i
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

/** 递归脱敏日志数据，避免 API Key、令牌或密码进入审计记录。 */
export function redact<T>(value: T): T {
  return redactValue(value) as T
}

function redactValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key) && value != null) return '[REDACTED]'
  if (typeof value === 'string') return value.replace(BEARER, 'Bearer [REDACTED]')
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]))
  }
  return value
}
