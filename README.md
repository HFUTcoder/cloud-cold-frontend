# Cloud-Code 小云 AI 助理 ✨

<div align="center">

**Cloud-Code 小云 AI 助理** — 前端应用

会话式 AI 对话平台，集成知识库工作台与长期记忆 / 宠物记忆浮层

![Vue](https://img.shields.io/badge/Vue-3.5.13-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?style=flat-square&logo=vite&logoColor=white)
![Ant Design Vue](https://img.shields.io/badge/Ant%20Design%20Vue-4.2-1677FF?style=flat-square&logo=antdesign&logoColor=white)
![Pinia](https://img.shields.io/badge/Pinia-3.0-FFD859?style=flat-square&logo=vue&logoColor=black)
![Vue Router](https://img.shields.io/badge/Vue%20Router-4.5-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)

</div>

## 🎯 核心特性

| 特性 | 说明 |
|------|------|
| 🤖 Agent 对话 | SSE 流式问答，展示思考过程、最终回答和知识库命中图片 |
| 📚 知识库工作台 | 创建、编辑知识库，上传 PDF，预览原文件，查看入库状态 |
| ✋ HITL 审批 | 弹窗审批，支持批准 / 拒绝 / 修改参数后继续执行 |
| 🐾 宠物记忆 | 可拖拽浮层，展示宠物状态和长期记忆，支持重命名、重建、删除 |
| 👤 用户系统 | 注册、登录、注销，Cookie / Session 登录态 |
| 💬 会话管理 | 创建、切换、历史回显、删除，Skill / 知识库绑定 |

## ✨ 功能详情

### Agent 对话

- SSE 流式输出，`fetch + getReader + TextDecoder` 手动解析 `text/event-stream`（非 EventSource）
- 处理全部 6 种 SSE 事件：`thinking_step`、`assistant_delta`、`final_answer`、`hitl_interrupt`、`knowledge_retrieval`、`error`
- `HomeView.vue`（1500+ 行）包含完整 Agent 逻辑：流解析、思考步骤展示、客户端 Markdown 渲染、知识库图片回显
- 首页只暴露 `fast` 和 `thinking` 两种模式（`modeOptions` 数组），`expert` 保留在常量中但不可选

### HITL 审批流程

当收到 `hitl_interrupt` 事件时：
1. 弹出审批弹窗，展示待审批的工具调用列表
2. 用户可对每个工具调用选择：批准 / 拒绝 / 修改参数后继续
3. 提交 `POST /hitl/checkpoint/resolve` → 调用 `POST /agent/resume` 恢复 Agent 流

参数编辑支持类型感知的表单字段，根据后端返回的 `argumentSpecs` 动态渲染。

### 知识库工作台

- `KnowledgeWorkspace.vue` 作为 `HomeView.vue` 的内嵌面板，非独立路由
- 侧栏导航列出用户知识库，主区域展示文档指标（总数、已入库、待处理、失败）
- PDF 上传（`POST /document/upload`，FormData），实时查看入库状态流转（`PENDING` → `INDEXING` → `INDEXED` / `FAILED`）
- 文档预览（iframe 加载 MinIO presigned URL）、文档删除

### 宠物记忆浮层

- `PetMemoryWidget.vue`（797 行）：右下角可拖拽 FAB 按钮 + 滑出面板
- FAB 位置通过 `localStorage` 键 `cloud-cold-pet-position` 持久化，恢复时有视口边界 clamp
- 面板展示：宠物名称（可改名）、情绪动画、记忆统计、主动学习按钮、最近记忆列表（最多 8 条）、删除记忆
- 宠物情绪通过 CSS class 驱动动画：`learning`（pulse）、`updated`（saturate）、`idle`（默认）
- 未登录时点击 FAB 触发 `request-login` 事件

## 🛠 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Vue | 3.5.13 | 前端框架 |
| TypeScript | 5.8 | 类型安全 |
| Vite | 6.2 | 构建工具 |
| Vue Router | 4.5 | 路由管理 |
| Pinia | 3.0 | 状态管理 |
| Ant Design Vue | 4.2 | UI 组件库 |
| ESLint | 9.22 | 代码检查 |
| Prettier | 3.5 | 代码格式化 |
| 原生 fetch | — | HTTP 请求 + SSE 流式解析（无 Axios） |

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 9+
- 可访问的 `cloud-cold-agent` 后端（默认 `http://localhost:8081/api`）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置后端地址

Vite 开发服务器代理 `/api` → `http://localhost:8081`（`vite.config.ts` 中配置）。

如需指向其他后端，创建 `.env.local`：

```bash
VITE_API_BASE_URL=http://your-backend:8081/api
```

### 3. 启动前端

```bash
npm run dev
```

访问地址：[http://localhost:5173](http://localhost:5173)

## 📁 项目结构

```
src
├── api/                         # 接口封装（9 个模块）
│   ├── request.ts               # 核心 HTTP 层（fetch 封装，credentials: 'include'）
│   ├── agent.ts                 # Agent SSE 流式接口（callAgentStream、resumeAgentStream）
│   ├── userMemory.ts            # 宠物记忆接口
│   ├── chat.ts                  # 会话 + 聊天历史接口
│   ├── knowledge.ts             # 知识库 CRUD 接口
│   ├── document.ts              # 文档上传 / CRUD 接口
│   ├── hitl.ts                  # HITL checkpoint 接口
│   ├── user.ts                  # 用户认证接口
│   └── skill.ts                 # Skill 元数据接口
├── assets/                      # 全局样式（main.css、base.css）
├── components/
│   ├── knowledge/               # 知识库工作台（KnowledgeWorkspace.vue）
│   ├── pet/                     # 宠物记忆浮层（PetMemoryWidget.vue，797 行）
│   └── icons/                   # SVG 图标组件
├── constants/
│   ├── agent.ts                 # AGENT_MODES、AGENT_MODE_LABELS
│   └── document.ts              # DOCUMENT_INDEX_STATUSES、DOCUMENT_INDEX_STATUS_LABELS
├── router/
│   └── index.ts                 # 路由配置（/ → HomeView，/about → AboutView）
├── types/
│   ├── agent.ts                 # AgentStreamEvent 等流式事件类型
│   ├── chat.ts                  # ChatConversation、ChatMemoryHistory
│   ├── document.ts              # DocumentVO
│   ├── hitl.ts                  # HitlCheckpointVO
│   ├── knowledge.ts             # KnowledgeVO、PageResult
│   ├── skill.ts                 # SkillMetadataVO
│   ├── user.ts                  # LoginUserVO、BaseResponse<T>
│   └── userMemory.ts            # UserLongTermMemory、UserPetState
└── views/
    ├── HomeView.vue             # 主业务入口（Agent 对话 + 知识库面板 + 宠物 FAB）
    └── AboutView.vue            # 脚手架示例页
```

## 🏛 架构约定

### 请求方式

| 场景 | 方式 | 说明 |
|------|------|------|
| 普通 JSON 请求 | `requestJson<T>(path, init)` | 带 `credentials: 'include'`，自动携带 Cookie |
| 文件上传 | `requestForm<T>(path, formData, init)` | FormData 提交，不设 Content-Type |
| Agent SSE 流式 | `fetch + getReader + TextDecoder` | 手动解析 SSE，支持 AbortSignal 中断 |

### 状态管理

主链路状态在 `HomeView.vue`、`KnowledgeWorkspace.vue`、`PetMemoryWidget.vue` 本地管理。`stores/counter.ts` 是 Pinia 示例，不在主链路中使用。

### 关键约定

- **路由**：`/` 是业务首页，`/about` 是脚手架示例页，非业务页面
- **知识库工作台**：首页内嵌面板，非独立 `/knowledge` 路由
- **Agent 模式**：首页只暴露 `fast` 和 `thinking`，`expert` 保留在常量中但不在 UI 展示
- **Skill 绑定**：首页只做单 Skill 绑定，后端支持多 Skill 不等同前端已支持多选
- **知识库绑定**：会自动创建会话；Skill 绑定不会
- **文档上传**：当前仅允许 PDF，扩展格式需同步后端 `DocumentReaderStrategy`
- **后端 ID 类型**：`Long` 实际返回 JSON 字符串，ID 比较以运行时 payload 为准
- **错误判断**：使用后端返回的 `code` 字段，不要用 `message.includes()` 字符串匹配
- **请求凭证**：普通请求必须走 `src/api/request.ts`，且保留 `credentials: 'include'`

## 📖 文档

- [AGENTS.md](AGENTS.md) — 项目地图与规则（AI 工具入口）
- [docs/architecture.md](docs/architecture.md) — 分层架构、主页面状态、接口链路、宠物记忆组件
- [docs/development.md](docs/development.md) — 本地开发、请求地址、启动、验证、联调
- [docs/design-docs/ref-frontend-architecture.md](docs/design-docs/ref-frontend-architecture.md) — 参考架构
- [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md) — 组件、请求、SSE、样式模式

