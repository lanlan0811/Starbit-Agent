# 路线图

衔星按四个可独立验收的里程碑推进。本文是公开进度摘要；详细需求以项目开发计划和当前 Issue/发布说明为准。状态以代码、测试和发布产物为证据，不以勾选项代替验收。

## 状态说明

| 状态 | 含义 |
|---|---|
| 已交付 | 功能进入 `master`，核心测试已覆盖 |
| 集成中 | 核心实现存在，仍需完成界面、边界或端到端验证 |
| 计划中 | 已定义需求与验收，尚不能作为稳定能力使用 |

## M1：核心循环与权限

状态：已交付，持续加固。

已覆盖：

- Electron/Main/Preload/React/TypeScript 分层工程；
- 本地 SQLite 会话与 append-only 事件日志、恢复；
- OpenAI 兼容 Chat Completions 与 Responses 流式 Provider；
- 11 个内置模型、三档思考映射、多模态 content parts 与 usage 归一化；
- Agent Loop、取消、工具调用回填与只读并行/写入串行；
- `Read`、`Write`、`Edit`、`Mkdir`、`LS`、`Glob`、`Grep`、`Bash`；
- 工作区边界、三级权限、会话/永久允许规则、危险命令和审计；
- Markdown、GFM、KaTeX、代码高亮和权限弹窗；
- `docs/prompts` 模块化提示词及稳定前缀指纹基础。

持续项包括自定义危险规则加载、更多 Provider 实机兼容测试、视频厂商降级和缓存诊断精度。

## M2：MCP、Skills 与终端

状态：核心能力已交付，PTY/打包持续验证。

已覆盖：

- MCP stdio、Streamable HTTP、SSE 回退、版本协商、工具刷新和重连；
- MCP 工具命名空间、逐工具启停、权限门控、敏感配置加密和不可信结果边界；
- Claude Skills 目录扫描、frontmatter、用户/工作区覆盖、渐进加载、斜杠触发和脚本工具；
- `PreToolUse`、`PostToolUse`、`UserPromptSubmit`、`PreCompact`、`SessionStart`、`SessionEnd` hooks；
- `utilityProcess + node-pty` 的交互终端，以及 xterm fit/search/serialize 基础；
- PowerShell、cmd 与 Git Bash 可配置 Shell。

发布门槛包括 Windows ConPTY 进程树清理、Electron ABI 重建、安装包内 native module 加载和关键 E2E。

## M3：浏览器、知识库与长期记忆

状态：集成中。

目标范围：

- WebContentsView 可视浏览器、多标签、地址栏、人工接管和操作高亮；
- 基于 CDP 的导航、点击、输入、滚动、快照、截图、上传和下载工具；
- 默认临时浏览器分区，登录态复用必须显式开启；
- 本地文档/网页导入、分块、OpenAI 兼容或离线 embedding、余弦 top-k 与 `kb_search`；
- 用户级和工作区级 `memory.md`、手工条目、会话摘要与记忆工具；
- 只识别工作区根目录 `AGENTS.md` 的项目规则；
- 模型、权限、Shell、浏览器、知识库和记忆的可视设置中心。

验收重点是所有外部内容保持 `<untrusted-data>` 边界，浏览器上传/下载受工作区权限控制，知识库来源可追溯，持久登录态默认关闭。

## M4：上下文、子代理与发布

状态：计划中。

目标范围：

- ContextManager token 计数、90% microcompaction、97% 硬顶摘要与手动 `/compact`；
- 压缩前可取消提示、压缩事件和可恢复结构化摘要；
- 低命中告警、前缀 diff、TTL/压缩/可避免 miss 分类与低于 95% 阻断的回归测试；
- `Task` 子代理、Explore/general 预设、独立上下文与用量统计；
- `TodoWrite` 与计划文档联动；
- Node/Python 工作区代码执行沙箱；
- 数据导出/导入、简体中文默认与多语言框架；
- 本地错误报告、自动更新和 electron-builder/NSIS 发布；
- 中英文开源文档、版本更新日志和三平台 CI/Release 验证。

## 全量验收

1. 打开工作区后，agent 能完成读、写、搜索、Shell、浏览器和知识库任务，权限行为符合矩阵。
2. 会话可恢复，每次权限判定可审计。
3. 超长上下文可压缩且不丢失目标、进度和关键文件。
4. 模型、思考强度、白名单、Shell、浏览器、知识库和记忆可配置并实际生效。
5. 主会话全局累计缓存命中率不低于 95%，统计口径可解释，前缀无意外漂移。
6. Claude Skills 与主流 MCP server 可用，脚本和外部工具不绕过权限。
7. 11 个内置模型可切换，视觉模型可处理图片/视频和浏览器截图。
8. `typecheck`、lint、unit、Electron E2E、build、打包以及 CI/Release 全部通过。

## 非承诺事项

路线图描述方向，不承诺具体发布日期、供应商模型长期可用性或尚未签名构建的生产支持。任何里程碑只有在实现、测试、文档和可运行产物同时满足时才算完成。
