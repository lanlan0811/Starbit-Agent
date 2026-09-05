import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 视频抽帧 —— 不支持原生 video_url 的厂商降级为图片序列。
 * 依赖外部 ffmpeg（可在设置中指定路径）；输出 JPEG data URL，用完即清理临时目录。
 */

export interface VideoFrameExtractor {
  (source: string, mimeType?: string): Promise<string[]>
}

export interface FrameExtractorOptions {
  /** ffmpeg 可执行文件路径（默认 PATH 中的 ffmpeg） */
  ffmpegPath?: string
  /** 每秒采样帧数（默认 1） */
  fps?: number
  /** 最多保留帧数（默认 16，均匀覆盖由 ffmpeg -frames:v 截断） */
  maxFrames?: number
  /** 抽帧总超时（默认 60s） */
  timeoutMs?: number
  /** 注入进程启动器便于测试 */
  run?: RunFfmpeg
}

export type RunFfmpeg = (options: { executable: string; args: string[]; timeoutMs: number }) => Promise<void>

const DEFAULT_FPS = 1
const DEFAULT_MAX_FRAMES = 16
const DEFAULT_TIMEOUT_MS = 60_000

/** 用 ffmpeg 将视频按帧采样为 JPEG data URL 序列。 */
export function createVideoFrameExtractor(options: FrameExtractorOptions = {}): VideoFrameExtractor {
  const run = options.run ?? defaultRun
  return async (source, _mimeType) => {
    if (/^data:/i.test(source)) throw new Error('抽帧输入需要本地视频文件路径，data URL 请使用支持 video_url 的模型')
    if (/^https?:\/\//i.test(source)) throw new Error('抽帧输入需要本地视频文件路径，远程视频请先下载到工作区')
    const ffmpegPath = options.ffmpegPath?.trim() || 'ffmpeg'
    const fps = options.fps && options.fps > 0 ? options.fps : DEFAULT_FPS
    const maxFrames = options.maxFrames && options.maxFrames > 0 ? options.maxFrames : DEFAULT_MAX_FRAMES
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS

    await fs.access(source)
    const dir = await mkdtemp(join(tmpdir(), 'starbit-frames-'))
    try {
      const pattern = join(dir, 'frame-%05d.jpg')
      await run({
        executable: ffmpegPath,
        args: ['-hide_banner', '-loglevel', 'error', '-i', source, '-vf', `fps=${fps}`, '-frames:v', String(maxFrames), '-q:v', '5', pattern],
        timeoutMs
      })
      const files = (await readdir(dir)).filter((name) => name.endsWith('.jpg')).sort()
      if (files.length === 0) throw new Error('ffmpeg 未产出任何视频帧；请确认文件为受支持的视频格式')
      // 帧统一由 ffmpeg 编码为 JPEG，与源容器格式无关
      const mime = 'image/jpeg'
      return await Promise.all(files.map(async (name) => {
        const bytes = await readFile(join(dir, name))
        return `data:${mime};base64,${bytes.toString('base64')}`
      }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function defaultRun(options: { executable: string; args: string[]; timeoutMs: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, { windowsHide: true })
    const timer = setTimeout(() => {
      child.kill('killed' as NodeJS.Signals)
      reject(new Error(`视频抽帧超时（${options.timeoutMs}ms）`))
    }, options.timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') reject(new Error('未找到 ffmpeg；请安装 ffmpeg 或在设置中指定其路径以启用视频抽帧'))
      else reject(new Error(`视频抽帧进程启动失败: ${error.message}`))
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 退出码 ${code ?? 'unknown'}`))
    })
  })
}
