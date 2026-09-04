# 故障排除

先记录 Starbit 版本、Windows 版本、当前工作区、模型、权限模式和最小复现步骤。分享信息前移除 API Key、Authorization header、MCP 环境变量、私人路径和文档内容。

## 开发环境无法安装

确认版本：

```powershell
node --version
pnpm --version
```

项目要求 Node.js 22 和锁文件对应的 pnpm。使用：

```powershell
corepack enable
pnpm install --frozen-lockfile
```

不要删除或手工改写锁文件来掩盖依赖错误。若 `node-pty` 原生模块与 Electron ABI 不匹配，运行：

```powershell
pnpm exec electron-builder install-app-deps
```

然后重新执行构建或 E2E。

## 应用启动后空白或立即退出

本地开发先运行 `pnpm build`，确认 Main、Preload 和 Renderer 都生成到 `out/`。随后执行 `pnpm start` 或 `pnpm test:e2e`。检查终端中的首个错误，而不是后续连锁错误。

若错误提到 Preload，确认构建输出包含 `out/preload/index.mjs`；若提到 `sql-wasm.wasm`，确认 `sql.js` 安装完整且打包配置包含所需资源。不要从不可信来源单独下载缺失二进制文件。

## 模型显示“尚未配置 API Key”

在“设置 → 模型连接”选择当前会话模型，输入密钥并保存。密钥按模型 ID 独立存储；给一个模型保存密钥不会自动配置其他模型。开发环境也可在启动进程中设置 `STARBIT_API_KEY`，但不得写进仓库。

如果系统提示凭证加密不可用，请在正常交互式 Windows 用户会话运行应用。远程服务、受限会话或无凭证设施的环境可能无法使用 Electron `safeStorage`。

## 模型连接测试失败

依次检查：

1. API Key、账户余额、模型访问权限和端点地区限制。
2. base URL 是否为 OpenAI 兼容 API 根路径，而不是控制台页面。
3. 当前模型 ID 是否确实由端点提供。
4. 网络代理、TLS 检查、防火墙和系统时间。
5. API 形态是 Chat Completions 还是 Responses。

连接测试有超时并只请求极短回复。供应商返回的原始错误可能包含请求 ID，但不应包含密钥；分享前仍需检查脱敏。

## 消息发送后没有回复

查看会话错误事件和状态栏：

- “等待确认”表示权限弹窗尚未处理。
- “运行中”持续过久时可按 Esc 取消，再检查模型和工具服务。
- 模型不支持请求中的图片/视频会返回 4xx；移除附件或换视觉模型。
- 工具循环中断后不要假设文件未改变，应先查看 git diff 或实际文件。

## 文件工具提示路径越界

文件路径必须位于当前工作区或显式授权根目录。确认会话绑定的工作区是否正确，避免用 `..`、网络映射或链接间接跳出。若确需访问其他目录，创建范围更小的新工作区或通过正式授权入口添加该根；不要关闭路径检查。

## 计划模式拒绝写入

计划模式只允许目录创建和匹配计划规则的 Markdown 文件。默认文件名需包含“计划”或 `plan`，扩展名为 `.md`。普通源码、配置和其他文档必须切换到“自动编辑”或“完全访问”。同一计划文件的后续修改应继续允许；若被拒绝，请记录完整规范化路径并报告缺陷。

## Shell 工具失败

在“设置 → Shell”检查可执行文件和启动参数。Windows 默认配置类似 PowerShell 的非交互单命令形式；cmd 与 Git Bash 的参数不同。路径含空格时把可执行文件作为单独字段，不要把程序和全部参数拼成一个字段。

工具命令在工作区运行，默认超时 120 秒，最大可请求 600 秒。非零退出码会作为错误。输出按 UTF-8 解码；旧程序输出本地代码页时可能乱码，可让命令切换 UTF-8 或使用支持 UTF-8 的替代程序。

## 终端无法打开或立即退出

先确认同一 Shell 可在 Windows 终端独立启动。开发环境执行 Electron native module 重建：

```powershell
pnpm exec electron-builder install-app-deps
```

打包版需确认 `node-pty` 被解包并与当前架构匹配。安全软件可能阻止 ConPTY 或子进程；只为可信安装包添加最小例外。关闭终端后若仍有子进程，记录 PID 和复现步骤，不要使用宽泛的递归结束命令。

## 工具结果被截断

超过限制的完整结果保存在当前工作区 `.starbit/tool-output/<tool-call-id>.txt`，聊天中只显示头尾和路径。让 agent 分页读取或缩小查询范围。该文件可能含敏感内容，也可能随工作区备份，请按需清理。

## Skill 未发现或无法加载

检查目录是否为 `.starbit/skills/<name>/SKILL.md` 或 `.claude/skills/<name>/SKILL.md`。frontmatter 必须从第一行开始，包含有效的单行 `name` 和 `description`。工作区同名技能覆盖用户级。更改后新建或重新进入会话，使冻结索引重新扫描。

脚本问题应在相同解释器和工作区复现。`.py` 默认使用 `STARBIT_PYTHON` 或 `python`；脚本非零退出时会失败。不要通过永久放宽 Shell 规则来修复脚本自身问题。

## MCP 显示 `error`

- stdio：确认命令、参数、工作目录和 PATH；协议只能写 stdout，日志写 stderr。
- HTTP/SSE：确认 URL 使用 HTTP(S)、证书有效、token 未过期。
- 工具为空：确认 server 完成初始化并实现 tools/list。
- 工具不出现：检查是否被逐工具禁用，以及配置是否在会话开始后修改。
- 调用断开：Starbit 只自动重连并重试一次，持续失败需修复 server。

详见 [MCP 指南](mcp.md)。

## 缓存命中率异常

新会话首轮、供应商 TTL 到期和压缩后的首次请求可以合理 miss。持续可避免 miss 时检查模型是否切换、工具/Skills/MCP 清单是否变化、提示模板是否修改，以及端点是否返回支持的 usage 字段。不要为了提高命中率而删除必要安全提示或错误地复用其他会话上下文。

## 本地数据库损坏或需要重置

先退出应用并备份精确的 Electron 用户数据目录。优先把 `starbit.db` 重命名为带日期的备份文件，再启动应用生成新数据库；不要对 `%APPDATA%`、用户目录或工作区执行递归删除。重置会移除会话、设置、权限规则、用量和审计记录，且加密密钥不能从损坏数据库自动恢复。

知识库数据库位于各工作区 `.starbit/knowledge.db`，与主数据库分开；重置主数据库不应被当作删除工作区资料的方式。

## E2E 在 CI 或本地失败

E2E 会构建 Electron 并使用隔离用户数据目录。确认已重建 native modules、图形依赖可用，Linux CI 使用 xvfb。先单独运行：

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm test:e2e
```

保留首个失败的 trace、截图和应用日志，但提交前脱敏。不要把 `test-results/` 或 `playwright-report/` 直接提交到仓库。

## 仍无法解决

普通缺陷按 [CONTRIBUTING.md](../../CONTRIBUTING.md) 提交最小复现。疑似凭证泄露、工作区越界、权限绕过、任意命令执行或提示注入突破，应停止使用受影响功能、轮换相关密钥，并按 [SECURITY.md](../../SECURITY.md) 私密报告。
