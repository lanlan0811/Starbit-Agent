# 更新日志

本项目遵循语义化版本。未发布变更记录在此处。

## [未发布]

### 新增

- 新增 OpenAI 兼容 Provider 核心，支持 Chat Completions 与 Responses 流式 SSE。
- 新增思考档位参数、多模态内容、函数工具和本地媒体请求组装。
- 新增五类厂商 usage 缓存字段归一化及稳定前缀 SHA-256 自检。
- 新增 9 项 Provider 单元测试和 Electron 启动 E2E。

### 修复

- 修复共享会话类型跨进程层级引用。
- 修复 Markdown 代码高亮依赖缺失与 ESLint 9 命令参数失效。
- CI 与 Release 统一使用锁文件对应的 pnpm。
