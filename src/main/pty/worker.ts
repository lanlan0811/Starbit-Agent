import type { PtyWorkerRequest } from './protocol'

interface UtilityParentPort {
  on(event: 'message', listener: (event: { data: PtyWorkerRequest }) => void): void
  postMessage(message: { type: 'dispatch'; request: PtyWorkerRequest }): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort
if (!parentPort) throw new Error('PTY dispatcher 必须由 Electron utilityProcess 启动')

parentPort.on('message', ({ data }) => {
  parentPort.postMessage({ type: 'dispatch', request: data })
})
