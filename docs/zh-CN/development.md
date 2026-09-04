# 开发指南

## 环境

使用 Node.js 22 与 pnpm 11.25.0。首次安装运行：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## 提交前检查

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

`test:e2e` 会先构建应用，再以隔离的临时 userData 目录启动 Electron。测试结束后会删除该临时目录。

新增共享类型时放入 `src/core`；Main 与 Renderer 只能通过 Preload 中声明的 IPC 契约通信。新增内置系统提示必须放入 `docs/prompts`。界面开发遵循 Starbit 设计系统：系统字体、亮色办公风、4px 基准间距和 Lucide SVG 图标。
