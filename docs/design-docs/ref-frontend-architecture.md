# 参考项目架构说明

本文记录 `cloud-cold-frontend` 当前真实架构，供新功能设计和 AI 工具上下文引用。

## 总体设计

当前前端不是多页应用。真实业务集中在首页 `/`，由 `HomeView.vue` 作为应用壳，组合聊天、会话、登录、Skill、知识库绑定、HITL、知识库工作台入口和宠物记忆浮层。

知识库工作台和宠物记忆已经拆成独立组件，但仍由首页承接登录态、入口和上下文。

## 状态边界

- `HomeView.vue`：聊天流式状态机、会话状态、登录态、绑定状态、HITL 状态。
- `KnowledgeWorkspace.vue`：知识库列表、文档列表、上传、预览、编辑弹窗。
- `PetMemoryWidget.vue`：宠物状态、记忆列表、浮层位置、重建 / 改名 / 删除动作。
- Pinia 当前没有承担主链路状态管理。

## 后端契约

前端默认对接 `cloud-cold-agent`：

- 普通 JSON 接口返回 `BaseResponse<T>`。
- 登录态通过 Cookie / Session。
- Agent 流式接口返回 `text/event-stream`。
- SSE 事件名是 `agent`。
- 后端 `Long` 字段运行时常为字符串。

## 当前业务能力边界

- 前端只暴露 `fast` 和 `thinking`。
- 前端只支持单 Skill 绑定。
- Skill 绑定不会自动创建会话。
- 知识库绑定会在没有活动会话时自动创建会话。
- 知识库上传只允许 PDF。
- 宠物记忆浮层接入真实 `/userMemory/*` 接口。

## 变更影响面

以下变更通常跨前后端：

- Agent 模式值。
- SSE 事件结构。
- HITL payload。
- 会话字段。
- Skill / 知识库绑定字段。
- 文档状态。
- `retrievedImages` 字段。
- 长期记忆 / 宠物状态字段。
- ID 类型与 `Long -> string` 策略。
