# Model integration

Starbit supports OpenAI-compatible APIs only, using either the `chat-completions` or `responses` shape. Built-in model metadata is defined in `src/core/models.ts`; network behavior lives in `src/main/provider`.

Each model specifies its ID, vendor, base URL, API shape, context and output limits, modalities, three reasoning levels, sampling allowlist, and cache-usage field layout. API keys are sensitive user settings and are never embedded in built-in model objects.

The provider supports text, image, video, and function-tool input. Remote and data URLs pass through directly. Local media must use an absolute path and is encoded as a data URL in the main process. Callers must verify that the selected model supports the requested modality.

Usage is normalized into prompt, cached, cache-write, output, and hit-rate values. Responses reads `input_tokens_details`; Chat Completions uses the model's top-level or `prompt_tokens_details` mapping.

The provider core and tests are complete in the current version. Model settings, encrypted credential storage, and the connection-test UI remain planned work.
