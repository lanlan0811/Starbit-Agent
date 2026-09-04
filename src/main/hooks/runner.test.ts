import { describe, expect, it } from 'vitest'
import { HookRunner } from './runner'

describe('HookRunner', () => {
  it('串行传递 payload 并支持阻断', async () => {
    const runner = new HookRunner()
    runner.setHooks([
      {
        id: 'modify',
        event: 'PreToolUse',
        command: process.execPath,
        args: ['-e', "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify({payload:{value:2},message:'已改写'})))"]
      },
      {
        id: 'deny',
        event: 'PreToolUse',
        command: process.execPath,
        args: ['-e', "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({decision:'deny',message:'已阻断'})))"]
      }
    ])
    const result = await runner.run('PreToolUse', { sessionId: 's', workspacePath: process.cwd(), payload: { value: 1 } })
    expect(result.allowed).toBe(false)
    expect(result.payload).toEqual({ value: 2 })
    expect(result.messages).toEqual(['已改写', '已阻断'])
  })
})
