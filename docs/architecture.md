# 前端架构

本文说明 `cloud-cold-frontend` 的分层架构、主页面职责和主要接口链路。AI 工具的简短入口见根目录 [AGENTS.md](../AGENTS.md)。

## 分层架构

```text
View / Component
  -> api/*
    -> request.ts / agent.ts
      -> cloud-cold-agent

constants/* 与 types/* 提供跨组件共享契约。
```

- `src/views/HomeView.vue`：当前主业务入口，承载聊天、会话、登录、Skill、知识库绑定、HITL 和宠物浮层挂载。
- `src/components/knowledge/KnowledgeWorkspace.vue`：知识库工作台。
- `src/components/pet/PetMemoryWidget.vue`：长期记忆 / 宠物记忆浮层。
- `src/api/request.ts`：普通 JSON / Form 请求统一入口。
- `src/api/agent.ts`：Agent SSE 请求与手动解析。
- `src/types/*`：接口类型和跨组件数据结构。
- `src/constants/*`：Agent 模式、文档状态等固定值。

## 路由

当前 `src/router/index.ts` 只有两个路由：

- `/` -> `HomeView`
- `/about` -> `AboutView`

真实业务几乎都在 `/`。知识库工作台通过 `HomeView.vue` 内部的 `knowledgeQaMode` 切换展示，不是独立业务路由。

## 首页职责

`HomeView.vue` 当前承担：

- 聊天主界面
- 会话列表
- 登录 / 注册 / 注销 / 删除会话弹窗
- Skill 绑定菜单
- 知识库绑定菜单
- HITL 审批弹窗
- 知识库工作台入口切换
- 宠物记忆浮层挂载点

主要运行行为：

1. 页面启动时尝试调用 `/user/get/login`。
2. 登录后自动拉取会话列表。
3. 已登录时“新建会话”会立即创建会话；未登录时只清空本地状态。
4. 首次提问如果没有活动会话，会自动创建会话。
5. 首次绑定知识库如果没有活动会话，会自动创建会话。
6. 绑定 Skill 如果没有活动会话，会提示先建会话或先发消息。
7. Assistant 消息分成思考内容和最终回答。
8. 收到 `knowledge_retrieval` 时在当前 assistant 消息中展示命中图片。
9. 收到 `hitl_interrupt` 时打开审批弹窗。

## 请求层

普通请求：

- 统一通过 `src/api/request.ts`。
- 固定带 `credentials: 'include'`。
- 默认解析后端统一 `BaseResponse<T>`。
- 返回 HTML 或非 JSON 时会抛出更明确的错误。

地址解析优先级：

1. `VITE_API_BASE_URL`
2. 浏览器运行在 `localhost` / `127.0.0.1` 且端口不是 `8081` 时，直接请求 `http://localhost:8081/api`
3. 其他情况使用相对路径 `/api`

因此本地 `http://localhost:5173` 场景通常不会经过 Vite 代理。

## Agent SSE 链路

当前没有使用浏览器原生 `EventSource`：

1. `fetch()` 调 `/agent/call` 或 `/agent/resume`
2. 读取 `response.body`
3. `TextDecoder` 拼接文本
4. 按 `\n\n` 切分 SSE block
5. 解析 `event: agent`
6. 反序列化 `data:` 为 `AgentStreamEvent`
7. 页面层按事件类型驱动 UI

已适配事件：

- `thinking_step`
- `assistant_delta`
- `final_answer`
- `hitl_interrupt`
- `knowledge_retrieval`
- `error`

`AgentStreamHandlers.onTransportError` 当前未被 `src/api/agent.ts` 实际调用。

## HITL 恢复链路

1. 收到 `hitl_interrupt`。
2. 打开 HITL 弹窗。
3. 必要时调用 `/hitl/checkpoint/get`。
4. 将 `arguments` 解析成结构化字段。
5. 用户选择 `APPROVED`、`REJECTED` 或 `EDIT`。
6. 提交 `/hitl/checkpoint/resolve`。
7. 调用 `/agent/resume`。
8. 继续消费恢复后的 SSE。

## 知识库工作台

`KnowledgeWorkspace.vue` 当前能力：

- 拉取我的知识库列表。
- 默认选中第一个知识库。
- 创建 / 编辑 / 删除知识库。
- 查看当前知识库文档列表。
- 上传 PDF 到当前知识库。
- 通过 `iframe + presigned URL` 预览原文件。
- 删除文档。
- 展示 `PENDING`、`INDEXING`、`INDEXED`、`FAILED` 状态。

上传成功提示是“已上传并完成入库”，对应后端同步入库行为。

## 宠物记忆浮层

`PetMemoryWidget.vue` 当前能力：

- 根据登录态决定是否可打开。
- 调用 `/userMemory/pet/state` 展示宠物名称、情绪、摘要和近期记忆。
- 调用 `/userMemory/list` 展示长期记忆列表。
- 支持宠物重命名。
- 支持手动触发长期记忆重建。
- 支持删除单条记忆。
- 浮层位置写入 `localStorage`。

## 接口概览

当前前端已接入的主要接口：

- 用户：`/user/register`、`/user/login`、`/user/get/login`、`/user/logout`
- 会话：`/chatConversation/create`、`/chatConversation/list/my`、`/chatConversation/get`、`/chatConversation/update/skills`、`/chatConversation/update/knowledge`、`/chatConversation/delete`
- 历史：`/chatMemory/history/list/conversation`
- Agent：`/agent/call`、`/agent/resume`
- HITL：`/hitl/checkpoint/get`、`/hitl/checkpoint/resolve`
- Skill：`/skill/list`
- 知识库：`/knowledge/create`、`/knowledge/update`、`/knowledge/delete`、`/knowledge/list/page/my`
- 文档：`/document/upload`、`/document/list/by/knowledge`、`/document/preview-url`、`/document/delete`
- 长期记忆：`/userMemory/pet/state`、`/userMemory/list`、`/userMemory/rebuild`、`/userMemory/rename`、`/userMemory/delete`

## 脚手架残留

这些文件当前不是主要业务入口：

- `src/views/AboutView.vue`
- `src/components/HelloWorld.vue`
- `src/components/TheWelcome.vue`
- `src/components/WelcomeItem.vue`
- `src/components/icons/*`
- `src/stores/counter.ts`
- `src/layouts/BasicLayout.vue`
