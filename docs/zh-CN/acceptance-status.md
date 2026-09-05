# 开发与验收状态

更新时间：2026-09-05。验收范围仍为开发计划的全部 M1–M4，以下记录不缩小范围。

## 当前验证证据

- `pnpm typecheck`、`pnpm lint`、`pnpm build` 与生产构建通过。
- 77 项单元测试通过，覆盖权限优先级、计划文档规则、符号链接边界、Provider 请求（含视频抽帧降级与 video_url 策略）、并行工具顺序、unified diff、长历史分批摘要、费用估算、视频抽帧（ffmpeg 注入）、会话归档解析、i18n 词典、知识库驱动与 MCP 真实 stdio 集成等。
- 缓存回归门禁（§3.6）：以"前缀一致 ⇒ 命中"为缓存语义，长前缀 24 轮会话累计命中率 ≥95% 通过；反例（system 混入时间戳导致前缀漂移）命中率显著低于门禁，证明门禁有效。
- 3 项 Electron E2E 通过：工作台/终端/浏览器/知识库/记忆入口；本地测试端点驱动的文件工具循环、压缩取消与会话恢复；并行子代理（explore + general fan-out）摘要回传与运行中取消恢复。
- 存储层按计划运行于 better-sqlite3（主引擎）+ sqlite-vec KNN 索引；驱动层在原生模块与运行时 ABI 不匹配时自动回退 sql.js（能力一致，仅失去扩展加载，知识库检索退化为 JS 余弦）。
- 自动更新（electron-updater，生产环境启用）、本地错误报告（userData/error-reports.log，含渲染/子进程崩溃采集）、会话与全量数据导出导入、zh-CN/en-US 界面切换已实现并有对应 IPC 与测试。
- GitHub CI（typecheck/lint/unit/e2e）与 Release workflow 配置完整；上一阶段提交的 CI 已成功，当前变更的远端 CI 与 Release 仍须分别验证。

## 剩余验收清单

| 范围 | 尚需完成或提供的证据 |
|---|---|
| M1 模型与多模态 | 11 个模型的真实协议兼容与视频抽帧实测（ffmpeg 依赖用户环境）；配置与模拟测试不能代替厂商实测 |
| M2 生态 | 主流 MCP 服务器（filesystem、fetch、GitHub）实机接入清单；当前集成测试使用自建 stdio 服务器 |
| M2 终端 | Windows 安装包中的 ConPTY 与进程树回收实测；xterm WebGL 渲染 |
| M3 浏览器 | 实页 CDP 操作、上传/下载、登录态复用等完整 E2E（当前仅面板冒烟） |
| M3 知识库 | 复杂 PDF/DOCX 解析与损坏文档恢复测试；sqlite-vec 在打包产物中的实测 |
| M4 缓存 | 真实服务端累计命中率 ≥95% 的后台数据证据（门禁与统计面板已就绪） |
| M4 发布 | NSIS 安装/卸载实测、自动更新 feed 实测（electron-builder.yml 的 publish URL 为占位符需替换）、三平台 Release workflow 成功 |

压缩后的消息快照用于确定性恢复；原事件日志保持追加式记录。脚本临时目录会被回收，输出受大小和时间限制。尚未完成的项目不得在发布说明中标记为已验收。
