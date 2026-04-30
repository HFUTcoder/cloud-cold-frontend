# AGENT.md

本文件面向 Claude Code、Codex、Cursor、Windsurf 等 AI 编程工具，目标是让新的 AI 工具进入 `cloud-cold-frontend` 仓库后，能按当前真实实现理解项目，而不是只看依赖清单或脚手架残留文件做推断。

## 1. 项目定位

`cloud-cold-frontend` 是 `cloud-cold-agent` 的前端项目。当前主界面同时承载两条业务线：

- 会话式 AI Agent 对话
- 知识库工作台

## 2. 必须先知道的事实

### 2.1 业务几乎都集中在两个大文件里

当前最重要的文件是：

- `src/views/HomeView.vue`
- `src/components/knowledge/KnowledgeWorkspace.vue`

它们负责的不是单点小功能，而是整个产品主流程。

### 2.2 知识库工作台不是独立路由，而是首页里的内嵌面板

当前路由只有：

- `/` -> `HomeView`
- `/about` -> `AboutView`

知识库工作台通过 `HomeView.vue` 里的 `knowledgeQaMode` 切换展示，不是 `/knowledge` 之类的独立路由。

所以：

- 不要把“知识库工作台”当成另一个页面体系
- 大部分知识库交互上下文仍然和首页状态绑在一起

### 2.3 当前 UI 只暴露 `fast` 和 `thinking`

`src/constants/agent.ts` 里仍然有：

- `FAST`
- `THINKING`
- `EXPERT`

但 `HomeView.vue` 当前真正渲染到模式菜单里的只有：

- `fast`
- `thinking`

不要误写成“前端已经支持 `expert` 模式切换”。

### 2.4 当前首页只做单 Skill 绑定

后端会话字段名叫 `selectedSkillList`，底层也支持多 Skill。

但当前前端交互是：

- 绑定时只传 `[skillName]`
- UI 只显示一个 `selectedSkillName`
- 解除绑定时传空数组

所以改 Skill 相关逻辑时，要分清：

- 后端底层能力
- 当前前端实际交互能力

### 2.5 Skill 菜单和 Skill 绑定不是一回事

当前前端行为是：

- 打开 Skill 菜单时，不强制要求登录
- 菜单会直接调用 `/skill/list`
- 但真正点击绑定 Skill 时，仍然要求登录
- 如果当前没有活动会话，Skill 绑定会直接报提示，不会自动帮你建会话

所以：

- 不要把“能看到 Skill 列表”误判成“匿名也能完成 Skill 绑定”
- 也不要把知识库绑定的自动建会话行为，套到 Skill 绑定上

### 2.6 当前知识库绑定会自动补建会话

知识库绑定的行为和 Skill 绑定不同：

- 需要登录
- 如果当前没有活动会话，会先调 `/chatConversation/create`
- 再调 `/chatConversation/update/knowledge`

如果你在改绑定链路，记得分别处理这两个入口。

### 2.7 当前知识库上传 UI 只支持 PDF

`KnowledgeWorkspace.vue` 的上传控件当前写死了：

- `accept=".pdf,application/pdf"`

这和后端当前只有 `PdfMultimodalProcessor` 相匹配。

如果你要扩展文档类型，前后端和文档都要一起改。

### 2.8 后端 `Long` 实际返回 `string`

后端 `cloud-cold-agent` 通过 `WebConfig` 把 `Long` 统一序列化成字符串。

当前前端很多类型文件仍把这些字段声明成 `number`，例如：

- `ChatConversation.id`
- `KnowledgeVO.id`
- `DocumentVO.id`
- 以及若干 `userId` / `knowledgeId` / `documentId`

这意味着：

- 运行时 payload 不一定真的是 number
- 代码里很多地方虽然 TS 写成 number，但实际可能拿到 string

修改比较逻辑、表单回填逻辑、接口类型时，必须以运行时数据为准。

### 2.9 当前 Agent 流式接口是手动 SSE 解析，不是 `EventSource`

当前实现是：

1. `fetch()`
2. `response.body.getReader()`
3. `TextDecoder`
4. 手动按 `\n\n` 切分 block
5. 解析 `event: agent`
6. 反序列化 `data:`

不要默认把这里当成浏览器原生 `EventSource` 逻辑。

### 2.10 当前前端已经适配 `knowledge_retrieval`

当前 `AgentStreamEvent` 和 `HomeView.vue` 已经接住：

- `knowledge_retrieval`

实际效果是：

- 实时消息里能展示知识库命中的图片
- 历史消息如果后端回绑了图片，也能继续显示

不要把这条能力漏掉。

### 2.11 `onTransportError` 已定义，但当前 `src/api/agent.ts` 没有实际触发它

这是一个很容易忽略的小事实：

- `AgentStreamHandlers` 里定义了 `onTransportError`
- `HomeView.vue` 在某些调用里也传了 `onTransportError`
- 但当前 `src/api/agent.ts` 并没有真正调用 `handlers.onTransportError`

如果你准备补“传输层错误回调”，要直接改 `src/api/agent.ts`，不是只改页面。

### 2.12 Ant Design Vue 已注册，但当前主界面基本不是 Antd 组件树

`main.ts` 里确实有：

- `app.use(Antd)`

但当前业务页面主要还是：

- 原生 `button`
- 原生 `input`
- 原生 `textarea`
- 原生 `select`
- 大量自定义 CSS

不要自动假设这里已经是完整 Ant Design 设计系统项目。

### 2.13 Pinia 已初始化，但主链路几乎不依赖 Store

`createPinia()` 已注册，但当前业务状态主要留在 `HomeView.vue` 和 `KnowledgeWorkspace.vue` 本地。

`src/stores/counter.ts` 仍是 Vite 默认示例残留，不属于主链路。

### 2.14 仓库里有不少脚手架残留文件

这些文件当前不是主要业务入口：

- `src/views/AboutView.vue`
- `src/components/HelloWorld.vue`
- `src/components/TheWelcome.vue`
- `src/components/WelcomeItem.vue`
- `src/components/icons/*`
- `src/stores/counter.ts`
- `src/layouts/BasicLayout.vue`

不要优先把时间花在这些文件上。

## 3. 快速事实

- 技术栈：Vue 3、TypeScript、Vite 6、Vue Router 4、Pinia、Ant Design Vue 4
- `package.json` 名称：`frontend-practice`
- 默认联调后端：`http://localhost:8081/api`
- 默认业务首页：`/`
- 另有一个未接入业务的示例路由：`/about`

## 4. 代码地图

### 4.1 最重要的文件

- `src/views/HomeView.vue`
  - 聊天、会话、登录、Skill、知识库绑定、HITL、页面壳
- `src/components/knowledge/KnowledgeWorkspace.vue`
  - 知识库工作台
- `src/api/request.ts`
  - 接口地址解析、`credentials: 'include'`、统一 JSON 解析
- `src/api/agent.ts`
  - SSE 手动解析
- `src/api/chat.ts`
  - 会话与历史消息
- `src/api/hitl.ts`
  - HITL 接口
- `src/api/knowledge.ts`
  - 知识库接口
- `src/api/document.ts`
  - 文档接口
- `src/api/user.ts`
  - 登录态接口
- `src/constants/agent.ts`
  - Agent 模式值
- `src/constants/document.ts`
  - 文档状态值
- `src/types/*`
  - 前后端类型定义

### 4.2 路由事实

当前 `src/router/index.ts` 只有两个路由：

- `/` -> `HomeView`
- `/about` -> `AboutView`

真正业务几乎都在 `/`。

## 5. 建议阅读顺序

### 5.1 看聊天 / Agent / HITL 问题

1. `src/views/HomeView.vue`
2. `src/api/agent.ts`
3. `src/types/agent.ts`
4. `src/api/chat.ts`
5. `src/api/hitl.ts`
6. `src/constants/agent.ts`

### 5.2 看知识库 / 文档问题

1. `src/components/knowledge/KnowledgeWorkspace.vue`
2. `src/api/knowledge.ts`
3. `src/api/document.ts`
4. `src/constants/document.ts`
5. `src/types/knowledge.ts`
6. `src/types/document.ts`

### 5.3 看登录态 / 请求问题

1. `src/api/request.ts`
2. `src/api/user.ts`
3. `src/types/user.ts`
4. `src/views/HomeView.vue`

## 6. 当前主链路

### 6.1 聊天提问链路

当前流程：

1. 用户输入问题
2. 如果还没有活动会话，先调 `/chatConversation/create`
3. 页面先插入用户消息和一个占位 assistant 消息
4. 调 `callAgentStream(...)`
5. 页面根据流式事件持续更新：
   - thinking 区
   - final answer 区
   - 知识库命中图片
   - HITL 弹窗

### 6.2 SSE 消费链路

当前实现不是 `EventSource`，而是：

1. `fetch()`
2. `response.body.getReader()`
3. `TextDecoder`
4. 手动按 `\n\n` 切分 block
5. 解析 `event: agent`
6. 反序列化 `data:`

当前前端适配的主要事件：

- `thinking_step`
- `assistant_delta`
- `final_answer`
- `hitl_interrupt`
- `knowledge_retrieval`
- `error`

### 6.3 HITL 恢复链路

当前流程：

1. 收到 `hitl_interrupt`
2. 打开审批弹窗
3. 如有必要，调用 `/hitl/checkpoint/get`
4. 将 arguments 解析成结构化字段
5. 用户选择：
   - `APPROVED`
   - `REJECTED`
   - `EDIT`
6. 提交 `/hitl/checkpoint/resolve`
7. 调 `/agent/resume`
8. 继续消费 SSE

### 6.4 知识库工作台链路

当前流程：

1. 登录后自动拉取知识库列表
2. 默认选中第一个知识库
3. 拉取当前知识库文档列表
4. 支持新建 / 编辑 / 删除知识库
5. 上传 PDF 到当前知识库
6. 通过 `/document/preview-url` 预览原文件
7. 删除文档

## 7. 请求与环境规则

### 7.1 所有普通请求都要走 `request.ts`

`src/api/request.ts` 当前负责：

- 拼接 `buildApiUrl`
- 自动带 `credentials: 'include'`
- 解析统一 `BaseResponse<T>`
- 对“返回了 HTML / 非 JSON”的错误做更友好的提示

不要在页面里重复手写一套通用 JSON 请求封装。

### 7.2 当前接口地址规则

优先级如下：

1. `VITE_API_BASE_URL`
2. 如果当前浏览器是 `localhost` / `127.0.0.1` 且端口不是 `8081`
   - 自动请求 `http://localhost:8081/api`
3. 其他情况使用 `/api`

这意味着：

- 本地开发时，请求经常不会经过 Vite 代理
- 调试跨域、Cookie、Network 面板时，要按“直接请求 8081”来理解

### 7.3 Cookie 登录态不能随便动

当前后端使用 Session + Cookie 认证，所以：

- 不要移除 `credentials: 'include'`
- 不要默认把所有请求改成 token 模式
- 如果真要改认证方式，要把这看成前后端联动重构

## 8. 开发规范

### 8.1 接口层规范

- 普通 JSON 接口优先放在 `src/api/*`
- 流式 Agent 接口继续走 `src/api/agent.ts`
- 不要在页面里直接散落大量 `fetch` 细节

### 8.2 类型规范

- 新字段优先补到 `src/types/*`
- 但要记住：运行时 payload 才是最终真相
- 特别是后端 `Long -> string` 的现状，不能只看 TS 注解

### 8.3 SSE 规范

- 不要把当前 Agent 流式接口直接替换成 `EventSource`
- SSE 事件名当前固定是 `agent`
- 事件类型和结构改动时，必须同时检查后端：
  - `AgentController`
  - `AgentStreamEvent`
  - `AgentStreamEventFactory`
- 如果你要补传输层错误回调，记得 `src/api/agent.ts` 目前并没有实际调用 `onTransportError`

### 8.4 页面修改规范

- 聊天主流程优先在 `HomeView.vue` 现有结构上做局部修改
- 新增独立块时再考虑拆组件
- 知识库工作台继续优先放在 `KnowledgeWorkspace.vue`
- 不要把知识库逻辑重新塞回首页脚本里

### 8.5 样式规范

- 当前页面高度依赖自定义 CSS 视觉语言
- 不要默认把页面改回通用脚手架样式
- 不要因为安装了 Ant Design Vue，就混入大量不一致的 Antd 组件而不做整体样式协调

## 9. 会影响后端联动的改动

下面这些改动默认要联动 `cloud-cold-agent`：

- Agent 模式值
- SSE 事件结构
- 会话字段
- Skill 绑定字段
- 会话绑定知识库字段
- HITL payload
- 聊天历史里的 `retrievedImages`
- 文档状态值
- `Long -> string` 序列化相关处理

## 10. 高风险误判提醒

- 不要把 `/about` 当成业务页面
- 不要把 Pinia 当成当前状态管理核心
- 不要把 Ant Design Vue 当成当前主界面组件体系
- 不要忽略“后端 ID 实际返回 string”
- 不要把“后端支持多个 Skill”误写成“前端已经支持多 Skill”
- 不要把当前 PDF-only 上传写成“支持任意文档格式”
- 不要把 Skill 绑定和知识库绑定的会话创建行为混为一谈
- 不要漏掉 `knowledge_retrieval` 事件和图片展示链路

## 11. 你准备改之前，最好先确认这几个问题

1. 这次改动是否会影响后端 SSE / Cookie / ID 类型行为？
2. 当前运行时拿到的 `id` 到底是 string 还是 number？
3. 这个改动是不是默认假设前端已经支持 `expert` 或多 Skill？
4. 这个改动会不会破坏 `HomeView.vue` 里现有的流式状态机？
5. 如果要改上传能力，后端文档读取链是否也已经同步扩展？
