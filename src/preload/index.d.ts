import type { IpcApi, MainToRendererEvent } from '../main/ipc/types'

declare global {
  interface Window {
    starbit: IpcApi
    onStarbitEvent: (cb: (event: MainToRendererEvent) => void) => () => void
  }
}

export {}
