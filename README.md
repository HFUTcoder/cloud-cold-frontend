# cloud-cold-frontend

`cloud-cold-frontend` 是 `cloud-cold-agent` 的前端项目，一个基于 `Vue 3 + Vite + TypeScript + Ant Design Vue` 的单页应用。它同时承载了两条核心业务：会话式 AI Agent 对话，以及知识库工作台。

## 主要能力

- 用户注册、登录、注销，依赖后端 `Session + Cookie` 维持登录态
- 会话创建、切换、历史消息回显、删除会话
- 智能体流式问答，前端通过 `fetch + ReadableStream` 手动消费 `SSE`
- 模式切换，当前界面提供 `fast` 与 `thinking`
- HITL 审批弹窗，可对待执行工具调用进行确认、拒绝或修改后恢复执行
- 会话级 Skill 绑定与 Skill 列表展示
- 知识库工作台：知识库创建、编辑、删除、文档上传、文档预览、文档删除、索引状态查看

## 技术栈

- Vue 3
- TypeScript
- Vite 6
- Vue Router 4
- Pinia
- Ant Design Vue 4

## 页面与代码结构

```text
cloud-cold-frontend
├── public
├── src
│   ├── api                     # 后端接口封装
│   ├── components
│   │   └── knowledge
│   │       └── KnowledgeWorkspace.vue
│   ├── constants              # 模式、文档状态等常量
│   ├── layouts
│   ├── router
│   ├── types                  # DTO / VO 对应的前端类型
│   └── views
│       └── HomeView.vue       # 当前主业务页，聊天与知识库入口都在这里
├── package.json
├── vite.config.ts
└── README.md
```

当前项目的业务中心主要在两个文件：

- `src/views/HomeView.vue`：聊天页面、会话列表、登录弹窗、模式切换、Skill 绑定、HITL 审批
- `src/components/knowledge/KnowledgeWorkspace.vue`：知识库工作台

## 与后端的对接方式

项目默认对接 `cloud-cold-agent`。

### 1. 普通 JSON 接口

- 统一通过 `src/api/request.ts` 发起请求
- 默认接口前缀是 `/api`
- 所有请求都会带上 `credentials: 'include'`

这意味着前后端联调时，后端登录态必须允许浏览器携带 Cookie。

### 2. Agent 流式接口

智能体调用不走 `EventSource`，而是前端自己解析 `text/event-stream`：

- `src/api/agent.ts` 调用 `/agent/call` 与 `/agent/resume`
- 使用 `ReadableStream` 逐块读取响应体
- 按 SSE block 手动解析 `event: agent`
- 再把数据分发给页面层

目前前端已经适配的事件类型有：

- `thinking_step`
- `assistant_delta`
- `final_answer`
- `hitl_interrupt`
- `error`

### 3. HITL 恢复链路

当后端发出 `hitl_interrupt` 时，前端会：

1. 打开审批弹窗
2. 必要时调用 `/hitl/checkpoint/get` 拉取检查点详情
3. 调用 `/hitl/checkpoint/resolve` 提交审批结果
4. 调用 `/agent/resume` 继续消费恢复后的流式结果

## 本地开发要求

- Node.js 18 及以上
- npm 9 及以上
- 已启动并可访问的 `cloud-cold-agent`

后端默认地址为 `http://localhost:8081/api`。

## 启动方式

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发环境

```bash
npm run dev
```

开发环境下，Vite 会把 `/api` 代理到：

```text
http://localhost:8081
```

对应配置位于 `vite.config.ts`。

### 3. 类型检查

```bash
npm run type-check
```

### 4. 构建生产包

```bash
npm run build
```

### 5. 代码检查与格式化

```bash
npm run lint
npm run format
```

## 可选的接口地址配置

如果不想使用默认代理或本地 `8081`，可以通过 `VITE_API_BASE_URL` 覆盖默认接口前缀。

项目的默认行为是：

- 浏览器运行在 `localhost` 且当前端口不是 `8081` 时，请求会自动指向 `http://localhost:8081/api`
- 其他情况下默认使用 `/api`

## 已接入的主要接口

### 用户

- `POST /user/register`
- `POST /user/login`
- `GET /user/get/login`
- `POST /user/logout`

### 会话与消息

- `POST /chatConversation/create`
- `GET /chatConversation/list/my`
- `GET /chatConversation/get`
- `POST /chatConversation/update/skills`
- `POST /chatConversation/delete`
- `GET /chatMemory/history/list/conversation`

### Agent 与 HITL

- `POST /agent/call`
- `POST /agent/resume`
- `GET /hitl/checkpoint/get`
- `POST /hitl/checkpoint/resolve`

### Skill

- `GET /skill/list`

### 知识库与文档

- `POST /knowledge/create`
- `POST /knowledge/update`
- `POST /knowledge/delete`
- `POST /knowledge/list/page/my`
- `POST /document/upload`
- `GET /document/list/by/knowledge`
- `GET /document/preview-url`
- `POST /document/delete`

## 当前实现特点

- 当前路由非常轻，主业务主要集中在首页
- `HomeView.vue` 体量较大，已经承担聊天主流程、会话管理和 HITL 交互
- 知识库工作台已经从主页面中拆出为独立组件，但仍由首页统一调度
- 前端常量里保留了 `expert` 模式定义，但当前界面默认只暴露 `fast` 和 `thinking`

## 联调建议

- 先启动 `cloud-cold-agent`
- 登录后再测试聊天与知识库能力
- 如果 Agent 请求报“未登录”或会话异常，优先检查浏览器是否成功携带 Cookie
- 如果流式回答没有显示，优先检查 `/agent/call` 响应头是否为 `text/event-stream`
