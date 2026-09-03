export type Primitive = string | number | boolean | null | undefined

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface Identifiable {
  id: string
}

/** 会话 ID */
export type SessionId = string

/** 消息 ID */
export type MessageId = string

/** 工具调用 ID */
export type ToolCallId = string
