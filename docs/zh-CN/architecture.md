# 架构说明

衔星采用 Electron 三层结构：Main 进程承担 Agent Host，Preload 只暴露类型化 IPC，Renderer 负责 React 界面。`src/core` 保存不依赖 Electron 的共享领域契约。

## 数据流

1. Renderer 通过 `window.starbit` 发起会话、模型与工作区请求。
2. Main 的 IPC handler 调用会话管理器或其他宿主服务。
3. 会话以 append-only 事件写入本地 SQLite，并可通过 replay 恢复界面。
4. Provider 将统一消息转换为 Chat Completions 或 Responses 请求，再把 SSE 归一化为文本、思考、工具、usage 和完成事件。

## Provider 边界

`src/main/provider` 负责：

- API 端点与请求体组装；
- 思考强度参数和采样参数白名单；
- 文本、图片和视频 content parts 转换；
- SSE 跨分块解码；
- 工具调用增量与 usage 归一化；
- system、tools、skills 三段稳定前缀的确定性序列化和指纹检查。

API Key 只作为调用参数进入请求 header，不属于模型静态配置，也不得进入事件日志。Agent Loop 接入后，Provider 事件将被转换为 append-only 会话事件。

## 依赖方向

`renderer -> preload contract -> main -> core`。共享类型必须放在 `core`；Renderer 不得直接导入 Main 的实现模块。
