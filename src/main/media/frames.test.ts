import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVideoFrameExtractor, type RunFfmpeg } from './frames'

/** 模拟 ffmpeg：按调用参数在输出目录生成指定数量的 JPEG 帧文件。 */
function fakeFfmpeg(frameCount: number): RunFfmpeg {
  void frameCount
  return async ({ args }) => {
    const patternIdx = args.findIndex((arg) => arg.includes('frame-'))
    if (patternIdx === -1) throw new Error('缺少输出模板')
    const dir = args[patternIdx].replace(/frame-%05d\.jpg$/, '')
    const frames = Number(args[args.indexOf('-frames:v') + 1])
    for (let i = 1; i <= frames; i += 1) {
      await writeFile(join(dir, `frame-${String(i).padStart(5, '0')}.jpg`), Buffer.from([0xff, 0xd8, i]))
    }
  }
}

describe('视频抽帧', () => {
  it('产出按序 data URL 并清理临时目录', async () => {
    const extractor = createVideoFrameExtractor({ run: fakeFfmpeg(3), maxFrames: 3 })
    const video = join(await mkdtemp(join(tmpdir(), 'starbit-vid-')), 'clip.mp4')
    try {
      await writeFile(video, Buffer.from('fake video'))
      const frames = await extractor(video, 'video/mp4')
      expect(frames).toHaveLength(3)
      expect(frames[0]).toMatch(/^data:image\/jpeg;base64,/)
      // 文件名按序：第二帧包含 0x02
      expect(Buffer.from(frames[1].split(',')[1], 'base64')[2]).toBe(2)
    } finally { await rm(video, { force: true }) }
  })

  it('data URL 与远程地址被拒绝', async () => {
    const extractor = createVideoFrameExtractor({ run: fakeFfmpeg(1) })
    await expect(extractor('data:video/mp4;base64,AAAA')).rejects.toThrow('本地视频文件路径')
    await expect(extractor('https://example.com/clip.mp4')).rejects.toThrow('本地视频文件路径')
  })

  it('缺少 ffmpeg 时给出可操作错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'starbit-vid-'))
    const video = join(dir, 'missing-codec.mp4')
    try {
      await writeFile(video, Buffer.from('fake video'))
      const extractor = createVideoFrameExtractor({
        run: async () => {
          const error = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
      })
      await expect(extractor(video)).rejects.toThrow('ffmpeg')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
