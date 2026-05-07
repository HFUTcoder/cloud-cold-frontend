# 前端开发

本文说明 `cloud-cold-frontend` 的本地开发、请求地址、启动、验证和联调排查方式。

## 环境要求

- Node.js 18+
- npm 9+
- 可访问的 `cloud-cold-agent`

## 安装与启动

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run type-check
npm run build
npm run preview
npm run lint
npm run format
```

## 后端地址

项目默认对接 `cloud-cold-agent`。

地址解析优先级：

1. `VITE_API_BASE_URL`
2. 如果浏览器运行在 `localhost` / `127.0.0.1` 且端口不是 `8081`，自动请求 `http://localhost:8081/api`
3. 其他情况使用相对路径 `/api`

示例：

```bash
VITE_API_BASE_URL=http://localhost:8081/api npm run dev
```

## Vite 代理

`vite.config.ts` 在开发态和预览态都配置了：

```text
/api -> http://localhost:8081
```

但本地最常见的 `http://localhost:5173` 场景会由 `request.ts` 直接构造到 `http://localhost:8081/api/...`，不一定经过 Vite 代理。

## 登录态

后端使用 `HttpSession + Redis Session`。前端请求必须携带 Cookie：

- 普通请求由 `src/api/request.ts` 固定带 `credentials: 'include'`
- Agent SSE 请求由 `src/api/agent.ts` 固定带 `credentials: 'include'`

不要在没有前后端联动设计的情况下把认证方式改成 token。

## 验证

类型检查：

```bash
npm run type-check
```

构建：

```bash
npm run build
```

代码检查与格式化：

```bash
npm run lint
npm run format
```

注意：`npm run lint` 和 `npm run format` 会自动修改文件，运行前确认当前工作区改动都属于本次任务范围。

## 联调排查

- 登录后仍报未登录：检查请求是否携带 Cookie，后端 Redis Session 是否可用。
- 请求返回 HTML：大概率请求地址错了，先看 `buildApiUrl(...)` 结果。
- SSE 没有内容：确认 `/agent/call` 响应头为 `text/event-stream`。
- 知识库命中图片不展示：检查后端是否发出 `knowledge_retrieval`，以及图片 URL 是否可访问。
- 知识库文档上传慢：后端当前是同步入库，不是异步排队。
- 文档上传失败：优先排查后端 MinIO、Elasticsearch、Embedding 和 PDF 多模态模型。
- 宠物浮层没有数据：确认已登录，且后端长期记忆配置启用。
- ID 比较异常：确认后端返回的 `id` 是字符串还是数字。
- 传输层错误回调不触发：`src/api/agent.ts` 当前没有实际调用 `onTransportError`。
