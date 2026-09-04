# 模型接入

衔星只支持 OpenAI 兼容协议，API 形态为 `chat-completions` 或 `responses`。内置模型元数据位于 `src/core/models.ts`，网络实现位于 `src/main/provider`。

每个模型配置包含模型 ID、厂商、baseURL、API 形态、上下文窗口、最大输出、模态能力、思考三档映射、采样参数白名单和 usage 缓存字段路径。API Key 属于敏感用户配置，不写入内置模型对象。

Provider 支持文本、图片、视频和函数工具。远程 URL 与 data URL 直接透传；本地媒体必须使用绝对路径，并在 Main 进程读取为 data URL。调用前应确认目标模型支持对应模态。

usage 最终归一化为输入、缓存命中、缓存写入、输出和命中率。Responses 使用 `input_tokens_details`；Chat Completions 按模型配置读取顶层或 `prompt_tokens_details` 字段。

当前版本已完成 Provider 核心与测试，模型设置、凭证加密和“连接测试”界面仍在后续里程碑中。
