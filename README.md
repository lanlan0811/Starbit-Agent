# 衔星 | Starbit

衔星是一款 Windows 优先的桌面端通用 AI Agent 工作台。项目采用 Electron、React 与 TypeScript，自研 Agent Loop，并通过 OpenAI 兼容协议接入模型。

> 当前状态：早期开发版本（0.1.0）。会话事件存储、权限核心、基础聊天界面、内置模型目录和 Provider 核心已落地；Agent Loop、模型设置界面及完整工具执行链路仍在开发中。

## 已实现

- Electron 主进程、隔离的 preload 与 React Renderer 工程骨架
- SQLite 本地会话与 append-only 事件日志
- 三级权限判定核心和危险命令规则
- Markdown、GFM、KaTeX 与代码高亮渲染
- 11 个内置模型的能力、思考档位和缓存字段配置
- Chat Completions / Responses 双形态流式 Provider
- 图片与视频内容单元转换、本地媒体 data URL 编码
- usage 缓存字段归一化、稳定前缀规范化与 SHA-256 自检
- Vitest 单元测试和 Playwright Electron 启动测试

## 开发环境

- Windows 10/11（主要支持平台）
- Node.js 22
- pnpm 11.25.0

```bash
pnpm install --frozen-lockfile
pnpm dev
```

质量检查：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

## 工程结构

```text
src/core/       与 Electron 解耦的领域类型、权限和工具契约
src/main/       Agent Host、会话存储、Provider 与 IPC
src/preload/    contextBridge 安全边界
src/renderer/   React 桌面界面
docs/prompts/   内置 Harness Agent 系统提示词
tests/e2e/      Electron 关键路径测试
```

详细设计见[架构说明](docs/zh-CN/architecture.md)、[模型接入](docs/zh-CN/models.md)与[开发指南](docs/zh-CN/development.md)。完整路线以仓库内开发计划为准。

## 安全与隐私

数据默认保存在本地。请勿提交 API Key、`.env`、数据库或测试输出。发现安全问题时请按 [SECURITY.md](SECURITY.md) 私下报告。

## 参与贡献

提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，并确保上述质量检查全部通过。

## 许可证

[MIT](LICENSE)
