# 为衔星 | Starbit 贡献

感谢你帮助改进衔星。本文适用于缺陷报告、功能提案、文档、测试和代码贡献。参与前请同时阅读 [行为准则](CODE_OF_CONDUCT.md) 与 [安全策略](SECURITY.md)。

## 项目方向与边界

衔星是 Windows 优先的 Electron 桌面 Harness Agent，核心约束如下：

- Main 进程承载 Agent Host，Renderer 不得直接获得 Node.js 能力；跨进程调用必须经过类型化 Preload IPC。
- 模型接口仅使用 OpenAI 兼容的 Chat Completions 或 Responses 形态。
- 会话采用 append-only 事件流；安全决策、工具结果与用量必须可恢复和审计。
- 工具统一进入 ToolRegistry 和 PermissionService，不得绕过工作区边界、三级权限或危险命令判定。
- 网页、文档、知识库与 MCP 输出属于不可信数据，必须保留 `<untrusted-data>` 边界。
- API Key 和 MCP 凭证不得以明文进入源码、日志、事件或普通设置；使用 Electron `safeStorage`。
- 内置系统提示词只放在 `docs/prompts/`，不得在业务代码中复制一份可漂移的提示词。
- 界面遵循 Starbit 设计系统，图标使用 SVG/Lucide，不使用 emoji 充当图标。
- 不硬编码用户路径、Shell、端口、凭证、语言环境或模型能力；通过配置、平台 API 或领域模型表达差异。

公开路线图见 [docs/zh-CN/roadmap.md](docs/zh-CN/roadmap.md)。较大改动应先通过 Issue 对齐目标、验收方式和里程碑；仓库维护者还可能提供内部开发计划，该计划优先于临时实现偏好。

## 报告缺陷

提交 Issue 前请搜索已有问题，并确认使用的是最新代码或最新发布版。报告至少包含：

- Starbit 版本或提交号、Windows 版本和架构；
- Node.js 与 pnpm 版本（仅开发环境问题）；
- 所选模型/API 形态、权限模式和相关功能；
- 最小复现步骤、预期行为与实际行为；
- 已脱敏的日志、错误信息或截图；
- 是否可稳定复现，以及最近一次正常工作的版本。

不要在 Issue 中粘贴 API Key、Authorization header、MCP 环境变量、私人文档、完整用户目录或未公开漏洞。安全问题必须走 [私密报告流程](SECURITY.md)。

## 提议功能

请先描述用户问题，而不是只描述实现方案。说明适用场景、不做该功能的影响、与现有权限/数据模型的关系、可验证的验收标准及兼容性风险。涉及 Provider、MCP、浏览器、安全、持久化格式或系统提示稳定前缀的改动，应给出迁移与回归测试方案。

## 开发环境

要求 Windows 10/11、Node.js 22 和仓库锁定的 pnpm 版本。其他平台可参与纯 TypeScript 工作，但桌面关键路径以 Windows 为首要验收环境。

```powershell
git clone https://github.com/lanlan0811/Starbit.git
Set-Location Starbit
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

常用质量命令：

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

打包或涉及 `node-pty` 的改动还应先执行：

```powershell
pnpm exec electron-builder install-app-deps
pnpm dist:win
```

更多细节见[开发指南](docs/zh-CN/development.md)和[架构说明](docs/zh-CN/architecture.md)。

## 变更流程

1. 从 `master` 创建范围单一的分支。
2. 为行为变化添加或更新测试；缺陷修复应尽量先加入能复现问题的测试。
3. 保持提交聚焦，提交信息说明实际结果。中英文文档应同步更新。
4. 若变更影响用户、配置、数据格式、安全边界或公开 API，更新对应文档与 `CHANGELOG.md`/`CHANGELOG.en.md`。
5. 运行全部质量命令，并对桌面布局、权限弹窗和关键交互做人工检查。
6. 提交 Pull Request，填写背景、方案、测试证据、风险、回滚方式和界面截图（如适用）。

不要提交 `node_modules`、`out`、`release`、测试报告、本地数据库、`.env`、设计缓存或 `.starbit` 运行数据。始终遵守 `.gitignore`；如确需修改忽略规则，请在 PR 中说明原因和数据风险。

## 代码与测试要求

- TypeScript 保持严格类型，不用无说明的 `any` 绕过契约。
- 共享领域类型放在 `src/core`；平台实现留在 `src/main`；Renderer 只使用 Preload 暴露的接口。
- 文件操作必须通过规范化绝对路径检查工作区/授权根，Windows 路径和 UTF-8 是必测场景。
- 所有写入、执行和外部数据入口都要考虑取消、超时、输出上限、错误可见性和审计。
- 只读工具可并行；写入、编辑与执行工具按稳定顺序串行，避免竞态。
- Provider 请求保持 system/tools/skills 前缀确定性；不能把时间戳或高频变化内容插入稳定前缀。
- 单元测试放在实现附近的 `*.test.ts`；端到端测试放在 `tests/e2e`，使用隔离的用户数据目录。
- 测试不得依赖真实付费 API、个人凭证或不可控公网服务。

## 文档与提示词

用户文档在 `docs/zh-CN` 与 `docs/en-US` 保持对应。命令、配置键和路径用代码格式，示例使用占位符而非真实凭证。

修改 `docs/prompts` 时，请说明对 Agent 行为、安全和缓存前缀的影响，运行 PromptAssembler 与 Agent Loop 相关测试，并避免在模板中加入每轮变化的内容。项目只把工作区根目录的 `AGENTS.md` 作为项目规则；不要增加隐式的替代规则文件名。

## 评审标准

维护者会重点检查：需求一致性、用户可验证结果、安全边界、失败模式、Windows 行为、数据迁移、无障碍与设计系统、测试覆盖、文档同步，以及 CI/Release 是否仍可成功。评审意见解决后再合并；合并并不保证立即发布。

## 许可证

提交贡献即表示你有权按仓库的 [MIT License](LICENSE) 提供该内容，并同意贡献按该许可证分发。
