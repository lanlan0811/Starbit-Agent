# 衔星 | Starbit — 系统提示词库

本项目内置系统提示词，作为 Harness Agent 的系统提示词模板。采用模块化模板 + `{{变量}}` 插值（§5.3）。

## 模板清单

| 文件 | 用途 |
|------|------|
| `identity.md` | 身份与安全声明（衔星、能力边界、数据不可信声明） |
| `main-loop.md` | 主 agent 行为规范：gather→act→verify 循环、工具选择原则、token 节制 |
| `tools.md` | 工具使用规则（由 ToolRegistry 动态拼接工具描述段落） |
| `plan-mode.md` | 计划模式专用（只读 + 计划文档创建/编辑放行、输出结构化计划） |
| `subagent.md` | 子代理模板（按类型插值：Explore/general） |
| `browser-agent.md` | 浏览器操作规范 |
| `compaction.md` | 压缩摘要模板（目标/已完成/未完成/关键文件/坑） |
| `security.md` | 安全规则（危险指令语义、拒绝后的行为、白名单说明） |
| `skills-guide.md` | SKILLS 触发与编写规范 |
| `memory-guide.md` | 记忆读写规范（memory.md 格式与更新规则、AGENTS.md 项目规则引用说明） |

## 变量插值

`{{workspacePath}} {{os}} {{shell}} {{today}} {{toolsSection}} {{skillsIndex}} {{memorySection}}`

稳定前缀优先（§3.6 规则 1：环境信息会话级冻结）。

> 注意：`src/main/prompts/` 下存在同名空占位文件，实际内容以本目录为准。开发时应保持两者同步，或统一迁移到此处。
