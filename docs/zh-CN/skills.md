# Skills 指南

Starbit 兼容以 `SKILL.md` 为入口的 Claude Skills 目录格式。Skill 是给 agent 的渐进式操作说明，可附带脚本和参考文件；它不是插件权限，也不会绕过 ToolRegistry 或 PermissionService。

## 发现目录

启动会话工具集时，Starbit 扫描：

```text
用户级：<USER_HOME>/.starbit/skills/<skill>/SKILL.md
用户级：<USER_HOME>/.claude/skills/<skill>/SKILL.md
工作区：<WORKSPACE>/.starbit/skills/<skill>/SKILL.md
工作区：<WORKSPACE>/.claude/skills/<skill>/SKILL.md
```

同名匹配不区分大小写，工作区技能覆盖用户级技能。每个损坏的技能会被跳过，不应阻断其他技能。设置中的“技能”面板展示名称、描述、作用域和发现的脚本数量。

## 最小结构

```text
example-skill/
├─ SKILL.md
├─ scripts/
│  └─ inspect.ps1
└─ references/
   └─ format.md
```

`SKILL.md` 必须以简单 YAML frontmatter 开始：

```markdown
---
name: example-skill
description: 在需要检查示例项目格式时使用。
---

# 示例技能

先读取工作区配置，再运行只读检查。修改前说明影响并遵守当前权限模式。
```

`name` 长度为 1–64，只允许字母、数字、点、下划线和连字符，且首字符必须是字母或数字。`description` 必填，应说明“什么时候使用”和“能完成什么”，不要写成空泛宣传。当前解析器只处理单行标量，不要使用多行 YAML、锚点或复杂对象。

## 渐进披露

会话开始时，系统提示只注入按名称排序的 `name + description` 索引，避免把所有技能正文塞进稳定前缀。模型需要某项技能时调用只读工具 `LoadSkill`；正文追加到当轮上下文，不回插历史。

在用户消息开头输入 `/example-skill` 可直接加载该技能。命令名到第一个空白为止，后面的文本仍是任务描述。找不到技能时会返回明确错误。

## 脚本工具

`scripts/` 下的文件会递归发现并注册为：

```text
skill__<技能名>__<脚本文件名>
```

常见扩展名默认解释器：

| 扩展名 | 默认执行方式 |
|---|---|
| `.js`、`.mjs` | 当前 Node/Electron 可执行环境 |
| `.py` | `STARBIT_PYTHON` 或 `python` |
| `.ps1` | Windows PowerShell，非交互模式 |
| `.cmd`、`.bat` | `cmd.exe` |
| 其他 | 作为可执行文件直接启动 |

脚本工作目录是会话工作区，接收显式参数数组，不通过拼接命令行执行。输出会被捕获并回传；非零退出码成为工具错误。脚本属于有副作用的风险级别 1 工具，在“计划”模式拒绝，在“自动编辑”模式询问。

## 编写原则

- 一个技能只解决一类清晰任务，步骤可验证且可重复。
- 使用相对技能根目录的引用，明确何时读取 `references/`、何时运行脚本。
- 不复制 API Key、机器路径、用户名或组织私有信息。
- 不要求 agent 忽略系统、安全、用户或工作区规则。
- 对写入、网络、付费 API 和删除操作明确标注前置条件与影响。
- 提供 Windows 路径、UTF-8、空格目录和失败退出码的处理方式。
- 大型参考资料按需加载；`SKILL.md` 保持为导航与必要流程。
- 给脚本添加确定性输出、超时友好行为和可测试的退出码。

## 安装第三方技能

安装前检查仓库来源、许可证、最近变更、`SKILL.md` 和全部脚本。固定到已审查版本，先放入工作区级目录做隔离验证，再决定是否提升为用户级。第三方说明中的命令和外部内容均不自动可信。

更新技能后，新会话会重新扫描。正在运行的会话保留冻结的技能索引，以免工具定义抖动和模型缓存失效。

## 排障

技能未显示时检查目录层级、文件名必须精确为 `SKILL.md`、frontmatter 是否位于文件开头、`name` 是否有效、`description` 是否为非空单行。脚本失败时在相同工作区和解释器下独立运行，检查执行权限、依赖、编码和退出码，但不要绕过权限弹窗。

贡献新的内置流程前，请同时阅读[系统提示词指南](prompts-guide.md)和仓库根目录的贡献指南。
