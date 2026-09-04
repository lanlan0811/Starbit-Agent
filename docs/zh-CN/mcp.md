# MCP 指南

Starbit 通过 Model Context Protocol（MCP）连接本地程序和远程服务，并把每个 MCP 工具转换为统一 ToolRegistry 项。MCP 扩展能力，但不会绕过工作区、安全提示或权限模式。

## 支持能力

- stdio：启动本地 MCP server，以标准输入输出通信。
- Streamable HTTP：连接 HTTP(S) MCP 端点。
- SSE：兼容旧式服务；Streamable HTTP 可配置连接失败后回退 SSE。
- 协议版本自动协商，兼容当前与旧版 MCP server。
- 工具分页获取、`list_changed` 动态刷新和一次崩溃重连。
- 服务器级启停与工具级启停。
- MCP 注解到只读/破坏性风险的映射，以及统一权限门控。

## 添加服务器

打开左侧“MCP 服务器”，填写唯一名称，选择传输方式，并提供可执行命令或 HTTP(S) URL。保存后会显示 `connecting`、`connected`、`disconnected` 或 `error` 状态及发现的工具。

服务器 ID 只能包含字母、数字、点、下划线和连字符，最长 64 个字符，且不能重复。远程 URL 只允许 `http:` 或 `https:`。生产环境优先使用 `https:`。

基础界面适合无需参数的可执行文件和标准 URL。带复杂参数、环境变量或 header 的高级配置使用以下结构；应用内部存储在本地设置中，不建议手工编辑数据库：

```json
[
  {
    "id": "filesystem",
    "name": "filesystem",
    "enabled": true,
    "transport": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "<WORKSPACE_PATH>"],
      "cwd": "<WORKSPACE_PATH>",
      "env": {}
    },
    "disabledTools": []
  }
]
```

远程示例：

```json
{
  "id": "research",
  "name": "research",
  "enabled": true,
  "transport": {
    "type": "streamable-http",
    "url": "https://mcp.example.test/service",
    "headers": { "Authorization": "Bearer <TOKEN>" },
    "fallbackToSse": true
  }
}
```

示例中的占位符必须替换为你控制的路径和凭证，绝不能提交真实值。

## 工具命名与更新时机

发现的工具使用：

```text
mcp__<安全化服务器名>__<安全化工具名>
```

非字母数字、下划线或连字符会被替换。工具标题只用于显示，调用使用完整命名空间名称。

为了保持模型缓存前缀稳定，服务器或工具列表变化不会改写正在运行的会话请求前缀。设置页保存配置后，新工具在下一次会话工具集组装时生效；已开始的 Agent Loop 保持其冻结定义。

## 权限行为

MCP server 的工具注解影响默认分类：只有明确 `readOnlyHint=true` 且未声明 `destructiveHint=true` 的工具才视为只读；破坏性工具风险级别最高；其余工具按有副作用处理。

权限语义标签为 `MCP:<server-id>:<tool-name>`。你可以针对单个工具保存规则，但建议从“本次允许”开始。来自 MCP 的文本和结构化数据会被标记为不可信，不得把返回内容中的指令当作系统命令。

## 凭证与进程环境

stdio server 只继承运行所需的一小组基础环境变量（例如 PATH、临时目录和用户目录），再合并显式配置的环境。不要依赖开发 Shell 中偶然存在的全部环境变量。

名称包含 `authorization`、`api-key`、`password`、`secret` 或 `token` 的 header/环境变量会从普通配置中移除，经 Electron `safeStorage` 单独加密。删除服务器前应同时在服务端撤销不再需要的令牌。

## 逐工具启停

连接成功后，在服务器卡片取消勾选不需要的工具。禁用列表按服务器保存。遵循最小权限原则：只启用当前工作流必需的工具，尤其是写文件、执行命令、发送消息、修改云数据或涉及付费调用的工具。

## 连接与重连

首次连接超时后状态会变为 `error` 并展示原因。工具调用因连接异常失败时，Starbit 会关闭旧连接、重新连接一次，再重试该调用。第二次失败会作为工具错误返回，不会无限重试。

Streamable HTTP 默认可回退到 SSE；如果服务明确不支持 SSE，可关闭 `fallbackToSse`，避免掩盖端点配置错误。

## 排障

连接失败时依次检查：

1. stdio 命令能否在独立终端启动，参数、工作目录和 PATH 是否正确。
2. server 是否把协议消息写到 stdout；诊断日志应写 stderr。
3. HTTP URL 是否完整、证书是否可信、代理是否允许访问。
4. token 是否过期，header 名称和值是否符合服务要求。
5. server 是否支持 MCP，以及协议初始化是否在 15 秒内完成。
6. 工具是否被 `disabledTools` 禁用，配置是否在当前会话开始后才修改。

错误信息可能包含路径或服务细节，分享前先脱敏。更多常见问题见[故障排除](troubleshooting.md)。

## 删除服务器

“移除”会关闭连接并删除服务器配置。删除不会撤销服务端令牌、清除远程数据或删除由工具创建的本地文件；这些操作需分别完成并保留必要审计记录。
