# cloud-cold-frontend

`cloud-cold-frontend` 是 `cloud-cold-agent` 的前端项目。当前实现是基于 `Vue 3 + Vite + TypeScript` 的单页应用，首页承载会话式 Agent 对话、知识库工作台、长期记忆 / 宠物记忆浮层。

## 当前能力

- 用户注册、登录、注销
- 会话创建、切换、历史回显和删除
- Agent 流式问答，展示思考过程、最终回答和知识库命中图片
- 会话级单 Skill 绑定
- 会话级知识库绑定，没有活动会话时自动创建会话
- HITL 审批弹窗，支持同意、拒绝、修改参数后继续执行
- 知识库工作台：创建、编辑、删除知识库，上传 PDF、预览原文件、删除文档、查看入库状态
- 宠物记忆浮层：展示宠物状态和长期记忆，支持重命名、重建、删除记忆

## 快速事实

- `package.json` 包名当前仍是 `frontend-practice`
- 默认业务首页：`/`
- `/about` 是 Vite 示例页，未接入主业务
- 默认后端：`http://localhost:8081/api`
- 普通请求固定带 `credentials: 'include'`
- Agent 流式接口不是 `EventSource`，而是手动解析 `text/event-stream`
- 后端 `Long` 常以字符串返回，前端部分类型仍写成 `number`
- 当前 UI 只暴露 `fast` 和 `thinking`，常量中仍保留 `expert`
- 当前知识库上传只允许 PDF

## 本地开发

环境要求：

- Node.js 18+
- npm 9+
- 可访问的 `cloud-cold-agent`

安装依赖并启动：

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

更多请求地址规则、代理说明和联调排查见 [docs/development.md](docs/development.md)。

## 文档

- [AGENTS.md](AGENTS.md)：AI 工具入口，只保留项目地图和硬性规则。
- [docs/architecture.md](docs/architecture.md)：前端分层架构、主页面状态、接口链路。
- [docs/development.md](docs/development.md)：本地开发、请求地址、启动、验证和联调。
- [docs/design-docs/ref-frontend-architecture.md](docs/design-docs/ref-frontend-architecture.md)：参考项目架构说明。
- [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md)：前端组件、请求、SSE、样式模式。

## 与后端联动

后端仓库是 `cloud-cold-agent`。修改以下契约时通常需要同步后端：

- Agent 模式值
- SSE 事件类型和字段
- 会话字段、Skill 绑定字段、知识库绑定字段
- HITL payload
- 聊天历史里的 `retrievedImages`
- 文档状态值
- 长期记忆 / 宠物状态字段
- ID 类型与 `Long -> string` 序列化策略
