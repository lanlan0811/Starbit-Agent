import { useAppStore } from '../stores/app'
import { translate, type Language } from './strings'

export type { Language }

/** 翻译函数；vars 支持 {name} 插值。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** 组件内使用：语言变化时自动触发重渲染。 */
export function useT(): { t: Translate; language: Language; setLanguage: (language: Language) => void } {
  const language = useAppStore((state) => state.language)
  const setLanguage = useAppStore((state) => state.setLanguage)
  return { t: (key, vars) => translate(language, key, vars), language, setLanguage }
}
