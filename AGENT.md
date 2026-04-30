# AGENT.md

本文件面向 Claude Code、Codex、Cursor、Windsurf 等 AI 编程工具，目标是让新工具在进入 `cloud-cold-frontend` 仓库后，能快速理解项目用途、代码结构、关键链路、前后端契约和前端开发规范。

## 1. 项目定位

`cloud-cold-frontend` 是 `cloud-cold-agent` 的前端项目，一个基于 `Vue 3 + Vite + TypeScript + Ant Design Vue` 的单页应用。

当前前端主要承载两条业务主线：

- 会话式 AI Agent 对话
- 知识库工作台

## 2. 快速事实

- 技术栈：Vue 3、TypeScript、Vite 6、Vue Router 4、Pinia、Ant Design Vue 4
- 构建工具：npm
- 默认开发服务器：Vite
- 默认后端目标：`http://localhost:8081/api`
- 主要页面入口：`src/views/HomeView.vue`
- 当前首页集成了聊天、会话、登录、Skill、HITL、知识库入口等多种能力

## 3. 启动与运行

常用命令：

```bash
npm install
npm run dev
npm run type-check
npm run build
npm run lint
npm run format
```

Vite 开发态与预览态都会把 `/api` 代理到：

```text
http://localhost:8081
```

相关配置在：

- `vite.config.ts`

## 4. 接口与环境规则

当前项目与后端的接口约定非常重要：

- 默认接口前缀为 `/api`
- 所有请求默认带 `credentials: 'include'`
- 后端登录态依赖 Cookie，因此前端不能随意移除 `credentials: 'include'`
- `VITE_API_BASE_URL` 可覆盖默认接口前缀
- 如果页面运行在 `localhost` 且端口不是 `8081`，`src/api/request.ts` 会自动把接口指向 `http://localhost:8081/api`

换句话说：

- 本项目默认假设后端是 `cloud-cold-agent`
- 前后端联调时，登录态和 SSE 都依赖当前这套接口封装规则

## 5. 前端开发规范

后续在本项目中写代码、改代码、生成代码时，默认必须遵循以下规范。

### 5.1 技术选型规范

- 必须继续使用 Vue 3 + TypeScript 进行开发
- 路由继续使用 Vue Router
- 全局状态如确有必要，可使用 Pinia；不要随意引入新的状态管理库
- 不要引入与当前项目风格冲突的新基础设施层方案

### 5.2 接口调用规范

- 所有普通 JSON 接口调用，必须优先通过 `src/api/request.ts` 中的 `requestJson` / `requestForm`
- 不要在页面组件里手写重复的 `fetch` JSON 请求封装
- 新接口应优先放在 `src/api/` 下对应模块文件中，而不是直接散落在页面里
- 接口返回值应优先在 `src/types/` 中补齐对应类型定义
- 不允许移除 `credentials: 'include'`，除非确认后端认证机制已经整体调整

### 5.3 Agent 与 SSE 规范

- Agent 调用必须沿用 `src/api/agent.ts` 当前的 `fetch + ReadableStream + 手动解析 SSE` 方案
- 不要直接把当前 Agent 流式接口替换成 `EventSource`
- SSE 事件名默认是 `agent`
- 当前前端适配的事件类型包括：
  - `thinking_step`
  - `assistant_delta`
  - `final_answer`
  - `hitl_interrupt`
  - `error`
- 如果修改 Agent 事件结构，必须同步检查后端 `cloud-cold-agent` 的：
  - `AgentController`
  - `AgentStreamEvent`
  - `AgentStreamEventFactory`

### 5.4 分层规范

- `src/api/`：接口调用封装
- `src/types/`：接口 DTO / VO 对应类型
- `src/constants/`：枚举值、状态文案等常量
- `src/components/`：可复用组件
- `src/views/`：页面级组件

一般要求：

- 页面负责交互编排与视图状态
- API 层负责接口调用
- 类型定义不要写在多个地方重复维护
- 常量值不要散落在页面逻辑里

### 5.5 页面修改规范

- 当前主业务集中在 `HomeView.vue`，修改聊天主流程时，优先在现有结构上局部调整，不要无边界地扩大文件复杂度
- 如果新增的是明显独立的一块业务 UI，优先抽成组件
- 已经独立出来的知识库工作台逻辑，优先继续放在 `components/knowledge/KnowledgeWorkspace.vue`
- 不要把知识库工作台逻辑重新塞回到首页脚本里

### 5.6 类型与数据规范

- 新增接口字段时，优先同步维护 `src/types/*`
- 对后端返回的可空字段要谨慎处理，不要默认字段一定存在
- 会话、HITL、知识库、文档等对象优先沿用当前已有类型，不要随意创建平行重复类型

### 5.7 样式规范

- 样式应优先复用当前页面与组件已有结构
- 不要无必要引入新的 CSS 方案或 UI 库
- 如果修改大段样式，注意同时检查桌面端与移动端表现
- 当前首页样式较重，改动时应优先保持既有视觉语言连贯

### 5.8 前后端协同规范

- 任何接口字段、事件结构、模式值、会话字段的改动，都必须默认视为前后端联动改动
- 当前前端强依赖后端这些接口：
  - `/agent/call`
  - `/agent/resume`
  - `/hitl/checkpoint/get`
  - `/hitl/checkpoint/resolve`
  - `/chatConversation/*`
  - `/chatMemory/history/*`
  - `/knowledge/*`
  - `/document/*`
- 修改前端契约时，必须同步检查 `cloud-cold-agent`

### 5.9 禁止事项

- 禁止随意移除 `credentials: 'include'`
- 禁止绕过 `src/api/request.ts` 另起一套通用 JSON 请求封装
- 禁止在未同步后端的情况下修改 SSE 事件协议
- 禁止引入与当前项目不一致的新 UI 基础设施作为默认方案
- 禁止把类型定义、接口调用、复杂业务逻辑无节制地重复散落到多个页面中

## 6. 代码地图

最关键的目录与职责如下：

- `src/api/`
  后端接口封装
- `src/types/`
  前后端契约对应的 TS 类型
- `src/constants/`
  模式、文档状态等常量
- `src/components/knowledge/`
  知识库工作台组件
- `src/views/`
  页面入口，当前核心是 `HomeView.vue`
- `src/router/`
  前端路由定义
- `src/layouts/`
  布局组件

## 7. 最重要的文件

如果要理解主链路，优先看这些文件：

- `src/views/HomeView.vue`
  当前主业务页，聊天、会话、登录、Skill、HITL 入口都在这里
- `src/components/knowledge/KnowledgeWorkspace.vue`
  知识库工作台主组件
- `src/api/request.ts`
  通用请求封装、接口地址解析、JSON 解析与错误处理
- `src/api/agent.ts`
  Agent SSE 消费逻辑
- `src/api/chat.ts`
  会话与历史消息接口
- `src/api/hitl.ts`
  HITL 检查点接口
- `src/api/knowledge.ts`
  知识库接口
- `src/api/document.ts`
  文档上传、删除、预览接口
- `src/types/agent.ts`
  Agent 事件结构定义
- `src/constants/agent.ts`
  Agent 模式常量
- `src/router/index.ts`
  当前路由入口

## 8. 核心业务链路

### 8.1 聊天提问链路

主链路如下：

1. 用户在 `HomeView.vue` 输入问题
2. 如无活动会话，先调用 `/chatConversation/create`
3. 页面追加用户消息与占位 assistant 消息
4. 调用 `callAgentStream(...)`
5. `src/api/agent.ts` 以流式方式消费后端返回
6. 页面根据事件类型更新思考区、正式回答区或 HITL 弹窗

### 8.2 Agent 事件消费链路

前端不会直接把后端返回的 SSE 原样交给浏览器处理，而是自己做解析：

1. `fetch()` 请求后端
2. 读取 `response.body`
3. 使用 `TextDecoder` 累积文本
4. 以空行切分 SSE block
5. 解析 `event:` 和 `data:`
6. 把 `agent` 事件转为 `AgentStreamEvent`
7. 交给页面层处理

### 8.3 HITL 恢复链路

当后端发出 `hitl_interrupt` 时：

1. `HomeView.vue` 打开审批弹窗
2. 必要时调 `/hitl/checkpoint/get`
3. 用户确认、拒绝或编辑参数
4. 调 `/hitl/checkpoint/resolve`
5. 再调 `/agent/resume`
6. 前端继续消费恢复后的 SSE 结果

### 8.4 知识库工作台链路

知识库工作台主要由 `KnowledgeWorkspace.vue` 负责：

1. 登录后自动拉取知识库分页列表
2. 选择知识库后加载文档列表
3. 支持创建 / 编辑 / 删除知识库
4. 支持上传文档
5. 支持通过 `/document/preview-url` 预览文档
6. 支持查看文档索引状态与删除文档

## 9. 当前实现特点

有几个项目特征需要优先知道：

- 当前主业务高度集中在 `HomeView.vue`
- 首页已经承担：
  - 聊天界面
  - 会话管理
  - 登录注册弹窗
  - Skill 绑定
  - HITL 审批
  - 知识库入口切换
- `KnowledgeWorkspace.vue` 已经从首页拆出，但仍由首页统一调度
- 路由很轻，当前真正的业务入口几乎只有首页
- `constants/agent.ts` 中保留了 `EXPERT`，但当前界面默认只展示 `FAST` 和 `THINKING`

## 10. 推荐的排查顺序

当你接到一个新任务时，建议按下面顺序建立上下文：

1. 先看对应页面或组件，确认用户交互入口
2. 再看 `src/api/*`，确认接口调用方式
3. 再看 `src/types/*`，确认前后端字段契约
4. 如果是 Agent 流式问题，再看 `src/api/agent.ts`
5. 如果是知识库问题，再看 `KnowledgeWorkspace.vue`
6. 如果接口契约有变化，再同步检查后端 `cloud-cold-agent`

## 11. 修改原则

- 保持前后端契约兼容，尤其是 SSE 事件结构
- 保持 Cookie 登录态机制不被破坏
- 尽量复用现有 API 层、类型层和常量层
- 不要无边界扩大 `HomeView.vue` 的复杂度
- 大改聊天主流程或 HITL 流程前，先确认后端联动影响
