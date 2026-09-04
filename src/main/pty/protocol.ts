export type PtyWorkerRequest =
  | { type: 'create'; terminalId: string; executable: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
  | { type: 'write'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'close'; terminalId: string }
  | { type: 'close-all' }

export type PtyWorkerEvent =
  | { type: 'ready'; terminalId: string; pid: number }
  | { type: 'data'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number; signal?: number }
  | { type: 'error'; terminalId: string; message: string }
  | { type: 'closed-all' }
