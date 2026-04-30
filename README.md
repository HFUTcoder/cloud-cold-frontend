# cloud-cold-frontend

`cloud-cold-frontend` 是 `cloud-cold-agent` 的前端项目。当前实现是一个基于 `Vue 3 + Vite + TypeScript` 的单页应用，主界面同时承载会话式 Agent 对话与知识库工作台两条业务线。

## 1. 当前实现概览

- 用户注册、登录、注销
- 会话创建、切换、历史回显、删除
- Agent 流式问答，手动消费 `text/event-stream`
- 思考过程展示与打字机式流式渲染
- 会话级 Skill 绑定
- 会话级知识库绑定
- HITL 审批弹窗，支持同意、拒绝、修改参数后继续执行
- 知识库工作台：创建、编辑、删除知识库，上传 PDF、预览原文件、删除文档、查看入库状态

## 2. 和代码一致的关键事实

- `package.json` 里的包名当前还是 `frontend-practice`
- 路由当前只有两个：
  - `/`：真实业务首页
  - `/about`：Vite 默认示例页，未接入业务
- 真正的业务中心主要在两个文件：
  - `src/views/HomeView.vue`
  - `src/components/knowledge/KnowledgeWorkspace.vue`
- 首页不是多页应用；知识库工作台是 `HomeView.vue` 内部切换出来的一个面板，不是独立路由
- 项目安装并全局注册了 `Ant Design Vue`，但当前主界面基本使用原生 HTML + 自定义 CSS
- `Pinia` 已安装并初始化，但当前业务主链路基本不依赖全局 Store
- 当前首页只暴露两个 Agent 模式：
  - `fast`
  - `thinking`
- 常量里仍保留 `expert`，但 UI 不显示
- 当前首页只做“单 Skill 绑定”，不是多选
- Skill 菜单当前可以在未登录时打开并加载列表，但真正执行绑定仍要求登录
- 知识库绑定要求登录；如果当前没有会话，前端会先自动创建会话再绑定知识库
- Skill 绑定不会自动创建会话；当前要求先有活动会话
- 知识库上传 UI 当前只允许 `PDF`
- 当前 SSE 适配的事件类型有：
  - `thinking_step`
  - `assistant_delta`
  - `final_answer`
  - `hitl_interrupt`
  - `knowledge_retrieval`
  - `error`
- 助手消息除了最终文本，还能展示知识库命中的图片
- 后端会把 `Long` 序列化成 `string`，前端很多 `src/types/*` 仍写成 `number`
- 本地开发时，请求不一定会经过 Vite 代理；`request.ts` 在最常见的 `localhost:5173` 场景下，会直接请求 `http://localhost:8081/api`

## 3. 技术栈

- Vue 3.5
- TypeScript 5.8
- Vite 6
- Vue Router 4
- Pinia 3
- Ant Design Vue 4
- 原生 `fetch`

## 4. 目录结构

```text
cloud-cold-frontend
├── AGENT.md
├── README.md
├── package.json
├── vite.config.ts
├── public/
└── src
    ├── api/                         # 接口封装
    ├── assets/                      # 全局样式
    ├── components/
    │   └── knowledge/
    │       └── KnowledgeWorkspace.vue
    ├── constants/                   # Agent 模式、文档状态
    ├── layouts/                     # 当前主链路未使用
    ├── router/                      # 路由
    ├── stores/                      # 仅保留示例 counter store
    ├── types/                       # TS 类型
    ├── views/
    │   ├── HomeView.vue             # 主业务入口
    │   └── AboutView.vue            # Vite 示例页
    ├── App.vue
    └── main.ts
```

## 5. 当前页面与交互

### 5.1 首页 `HomeView.vue`

首页当前同时承担：

- 聊天主界面
- 会话列表
- 登录 / 注册 / 注销 / 删除会话弹窗
- Skill 绑定菜单
- 知识库绑定菜单
- HITL 审批弹窗
- 知识库工作台入口切换

主要交互特点：

- 登录后会自动拉取会话列表
- “新建会话”按钮在已登录时会立即创建会话；未登录时只清空本地状态
- 首次提问如果当前没有会话，会自动创建会话
- 首次绑定知识库如果当前没有会话，也会自动创建会话
- 绑定 Skill 时如果没有活动会话，会直接提示用户先建会话或先发消息
- Assistant 消息分成“思考内容”和“最终回答”两块展示
- 如命中知识库图片，会在消息里显示“知识库命中图片”卡片
- HITL 审批时，会把工具参数解析成结构化表单，支持编辑后恢复执行

### 5.2 知识库工作台 `KnowledgeWorkspace.vue`

当前能力：

- 拉取我的知识库列表
- 创建 / 编辑 / 删除知识库
- 查看当前知识库文档列表
- 上传 PDF 到当前知识库
- 通过 `iframe + presigned URL` 预览原文件
- 删除文档
- 查看入库状态：
  - `PENDING`
  - `INDEXING`
  - `INDEXED`
  - `FAILED`

## 6. 与后端的对接方式

项目默认对接 `cloud-cold-agent`。

### 6.1 普通 JSON 接口

- 统一通过 `src/api/request.ts` 发起
- 所有请求固定带 `credentials: 'include'`
- 默认按后端统一 `BaseResponse<T>` 解析
- 如果接口返回 HTML 或其它非 JSON 内容，会给出更明确的错误提示

接口地址解析优先级如下：

1. `VITE_API_BASE_URL`
2. 如果浏览器运行在 `localhost` / `127.0.0.1` 且端口不是 `8081`
   - 自动请求 `http://localhost:8081/api`
3. 其他情况使用相对路径 `/api`

这意味着：

- 本地开发时，最常见的 `http://localhost:5173` 场景通常会直接打到 `http://localhost:8081/api`
- `vite.config.ts` 中的 `/api` 代理仍然存在，但更多是兜底或其它部署场景使用

### 6.2 Agent 流式接口

当前没有用浏览器原生 `EventSource`，而是手动解析 SSE：

1. `fetch()` 调 `/agent/call` 或 `/agent/resume`
2. 读取 `response.body`
3. `TextDecoder` 拼接文本
4. 按空行切分 SSE block
5. 解析 `event: agent`
6. 把 `data:` JSON 反序列化为 `AgentStreamEvent`
7. 页面层按事件类型驱动 UI

当前前端已适配的主要事件：

- `thinking_step`
- `assistant_delta`
- `final_answer`
- `hitl_interrupt`
- `knowledge_retrieval`
- `error`

### 6.3 HITL 恢复链路

当前前端行为是：

1. 收到 `hitl_interrupt`
2. 打开 HITL 弹窗
3. 必要时调用 `/hitl/checkpoint/get`
4. 将 arguments 解析成结构化字段
5. 用户选择：
   - `APPROVED`
   - `REJECTED`
   - `EDIT`
6. 提交 `/hitl/checkpoint/resolve`
7. 调 `/agent/resume`
8. 继续消费恢复后的 SSE

### 6.4 知识库问答与图片展示

当前交互是：

1. 会话绑定知识库
2. 用户提问
3. 后端先做知识库预检索
4. 如果命中图片，前端收到 `knowledge_retrieval`
5. 当前这条 assistant 消息会展示命中的图片卡片
6. 后续拉取历史消息时，如果后端已回绑这些图片，也能继续回显

## 7. 当前真实技术现状

### 7.1 Ant Design Vue 已注册，但当前主界面不是 Antd 风格页面

不要因为 `main.ts` 里有 `app.use(Antd)`，就以为当前业务页面主要使用 `<a-button>`、`<a-form>` 等组件。

当前页面几乎都是：

- 原生 `button`
- 原生 `input`
- 原生 `textarea`
- 原生 `select`
- 大量定制 CSS

### 7.2 Pinia 存在，但业务状态主要是组件内局部状态

当前业务流程没有依赖 Pinia Store 编排。

`src/stores/counter.ts` 仍然是 Vite 默认示例残留，主链路未使用。

### 7.3 后端 `Long` 实际返回 `string`

后端 `WebConfig` 会把 `Long` 转成字符串返回，所以运行时要特别注意：

- `ChatConversation.id`
- `KnowledgeVO.id`
- `DocumentVO.id`
- `userId`
- `knowledgeId`
- `documentId`

这些值虽然在 `src/types/*` 中常写成 `number`，但运行时常常是字符串。

### 7.4 当前知识库上传只允许 PDF

`KnowledgeWorkspace.vue` 的上传控件当前写死了：

- `accept=".pdf,application/pdf"`

这和后端当前只有 `PdfMultimodalProcessor` 是一致的。

## 8. 本地开发

### 8.1 环境要求

- Node.js 18+
- npm 9+
- 可访问的 `cloud-cold-agent`

### 8.2 安装依赖

```bash
npm install
```

### 8.3 启动开发环境

```bash
npm run dev
```

### 8.4 类型检查

```bash
npm run type-check
```

### 8.5 构建

```bash
npm run build
```

### 8.6 预览构建结果

```bash
npm run preview
```

### 8.7 代码检查与格式化

```bash
npm run lint
npm run format
```

## 9. Vite 代理

`vite.config.ts` 当前在开发态和预览态都把 `/api` 代理到：

```text
http://localhost:8081
```

但要注意：

- 这不代表本地开发一定会走代理
- `request.ts` 在 `localhost:5173` 这类最常见场景下，会优先构造成 `http://localhost:8081/api/...`
- 只有在地址解析结果是相对路径 `/api/...` 时，Vite 代理才会接管

## 10. 已接入的主要接口

### 10.1 用户

- `POST /user/register`
- `POST /user/login`
- `GET /user/get/login`
- `POST /user/logout`

### 10.2 会话与消息

- `POST /chatConversation/create`
- `GET /chatConversation/list/my`
- `GET /chatConversation/get`
- `POST /chatConversation/update/skills`
- `POST /chatConversation/update/knowledge`
- `POST /chatConversation/delete`
- `GET /chatMemory/history/list/conversation`

### 10.3 Agent 与 HITL

- `POST /agent/call`
- `POST /agent/resume`
- `GET /hitl/checkpoint/get`
- `POST /hitl/checkpoint/resolve`

### 10.4 Skill

- `GET /skill/list`

### 10.5 知识库与文档

- `POST /knowledge/create`
- `POST /knowledge/update`
- `POST /knowledge/delete`
- `POST /knowledge/list/page/my`
- `POST /document/upload`
- `GET /document/list/by/knowledge`
- `GET /document/preview-url`
- `POST /document/delete`

## 11. 当前有哪些“不是主链路”的残留文件

下面这些文件当前不是主要业务入口：

- `src/views/AboutView.vue`
- `src/components/HelloWorld.vue`
- `src/components/TheWelcome.vue`
- `src/components/WelcomeItem.vue`
- `src/components/icons/*`
- `src/stores/counter.ts`
- `src/layouts/BasicLayout.vue`

它们更多是脚手架残留，不要把主要时间花在这些文件上。

## 12. 联调注意事项

- 如果登录后接口仍报未登录，优先检查浏览器 Cookie 是否成功携带
- 如果 SSE 没有内容，先确认 `/agent/call` 响应头是否为 `text/event-stream`
- 如果知识库命中图片没有展示，优先检查后端是否发出了 `knowledge_retrieval`
- 如果知识库里看不到文档，优先检查后端 MinIO / Elasticsearch / PDF 入库链
- 如果前端比较 `id` 时行为奇怪，优先确认是不是后端返回了字符串 ID
- 如果想让前端也显示 `expert`，需要前后端一起评估模式展示与文案
