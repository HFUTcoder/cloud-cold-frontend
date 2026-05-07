# AGENTS.md

## 1. 项目概述

`cloud-cold-frontend` 是 `cloud-cold-agent` 的前端项目，承载会话式 Agent 对话、知识库工作台、长期记忆 / 宠物记忆浮层三条主线。技术栈是 Vue 3.5、TypeScript 5.8、Vite 6、Vue Router 4、Pinia 3、Ant Design Vue 4 和原生 `fetch`。真实业务入口集中在 `src/views/HomeView.vue`、`src/components/knowledge/KnowledgeWorkspace.vue`、`src/components/pet/PetMemoryWidget.vue`，详细架构和开发说明在 `docs/`。

## 2. 快速命令

| 目的 | 命令 |
| --- | --- |
| 安装依赖 | `npm install` |
| 启动开发环境 | `npm run dev` |
| 类型检查 | `npm run type-check` |
| 构建 | `npm run build` |
| 预览构建结果 | `npm run preview` |
| lint 并自动修复 | `npm run lint` |
| 格式化 | `npm run format` |

配置入口：

- 默认后端：`http://localhost:8081/api`
- 环境覆盖：`VITE_API_BASE_URL`
- Vite 代理：`/api -> http://localhost:8081`
- 环境文件：`.env`、`.env.local`、`.env.[mode]`、`.env.[mode].local`
- Vite 会自动加载当前 mode 对应的环境文件，不依赖额外启动脚本

请求地址、代理和联调细节见 [docs/development.md](docs/development.md)。

## 3. 后端架构

后端项目是同级仓库 `cloud-cold-agent`，前端依赖的关键后端能力：

- 用户与登录态：`/user/*`，基于 Cookie / Session
- 会话与历史：`/chatConversation/*`、`/chatMemory/history/*`
- Agent SSE：`/agent/call`、`/agent/resume`
- HITL：`/hitl/checkpoint/*`
- Skill：当前前端主要使用 `/skill/list` 和会话 Skill 绑定接口
- 知识库与文档：`/knowledge/*`、`/document/*`
- 长期记忆 / 宠物记忆：`/userMemory/pet/state`、`/userMemory/list`、`/userMemory/rebuild`、`/userMemory/rename`、`/userMemory/delete`

前后端术语映射：

| 前端术语 | 后端术语 / 字段 |
| --- | --- |
| Agent 模式 | `fast` / `thinking` / `expert` |
| 会话 | `conversationId` |
| Skill 绑定 | `selectedSkillList` |
| 知识库绑定 | `knowledgeId` |
| HITL 中断 | `interruptId` / checkpoint |
| 知识库命中图片 | `knowledge_retrieval` / `retrievedImages` |
| 宠物 | `userMemory` / `UserLongTermMemory` |
| 宠物名称 | `petName`（Redis `user_memory:pet_name:{userId}`） |
| 宠物情绪 | `petMood`：`learning` / `updated` / `idle` |
| 记忆类型 | `memoryType`：`USER_PROFILE` / `FACT` / `PREFERENCE` |

详细后端契约见 [docs/architecture.md](docs/architecture.md)。

## 4. 前端架构

```text
src
├── api/                         # 接口封装（request.ts 通用、agent.ts SSE、userMemory.ts 宠物记忆）
├── assets/                      # 全局样式
├── components/
│   ├── knowledge/               # 知识库工作台
│   └── pet/                     # 宠物记忆浮层（PetMemoryWidget.vue，797 行）
├── constants/                   # Agent 模式、文档状态
├── router/                      # 当前只有 / 和 /about
├── stores/                      # Pinia 示例 store，非主链路
├── types/                       # UserLongTermMemory、UserPetState、ChatMemoryHistory 等
└── views/
    ├── HomeView.vue             # 主业务入口（Agent 对话 + 知识库面板 + 宠物 FAB）
    └── AboutView.vue            # 脚手架示例页
```

核心约定：

- 路由：`/` 是真实业务首页，`/about` 是示例页
- API 层：普通 JSON/Form 请求走 `src/api/request.ts`（带 `credentials: 'include'`），Agent SSE 走 `src/api/agent.ts`（`fetch + getReader + TextDecoder`），宠物记忆走 `src/api/userMemory.ts`
- 状态：主链路状态主要在 `HomeView.vue`、`KnowledgeWorkspace.vue`、`PetMemoryWidget.vue` 本地，没有全局 Pinia store
- 组件库：Ant Design Vue 已注册，但主界面主要是原生 HTML + 自定义 CSS
- 组件边界：知识库逻辑留在 `KnowledgeWorkspace.vue`，宠物记忆逻辑留在 `PetMemoryWidget.vue`

宠物记忆组件要点：

- `PetMemoryWidget.vue`：可拖拽 FAB + 滑出面板，状态自管理
- FAB 位置通过 `localStorage` 键 `cloud-cold-pet-position` 持久化，恢复时有视口边界 clamp
- 面板展示：宠物名称（可改名）、记忆统计、主动学习按钮、记忆高亮、最近长期记忆列表（最多 8 条）、删除记忆
- 宠物情绪通过 CSS class 驱动动画：`learning`（pulse）、`updated`（saturate）、`idle`（默认）
- 未登录时点击 FAB 触发 `request-login` 事件

详细说明见 [docs/architecture.md](docs/architecture.md) 和 [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md)。

## 5. 关键约定

- 业务主入口是 `/` 的 `HomeView.vue`；`/about` 不是业务页面。详见 [docs/architecture.md](docs/architecture.md)。
- 知识库工作台是首页内嵌面板，不是独立 `/knowledge` 路由。详见 [docs/architecture.md](docs/architecture.md)。
- `PetMemoryWidget.vue` 已接入真实 `/userMemory/*` 接口，不是装饰组件。修改宠物记忆 UI 时注意后端 `memoryType` 枚举（USER_PROFILE/FACT/PREFERENCE）和前端 `memoryTypeLabelMap` 的同步。详见 [docs/architecture.md](docs/architecture.md)。
- 当前首页只暴露 `fast` 和 `thinking`，`expert` 只保留在常量里。详见 [docs/design-docs/ref-frontend-architecture.md](docs/design-docs/ref-frontend-architecture.md)。
- 当前首页只做单 Skill 绑定；后端支持多 Skill 不代表前端 UI 已支持多选。详见 [docs/design-docs/ref-frontend-architecture.md](docs/design-docs/ref-frontend-architecture.md)。
- Skill 绑定不会自动创建会话，知识库绑定会自动创建会话。详见 [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md)。
- 知识库上传 UI 当前只允许 PDF；扩展格式必须同步 `cloud-cold-agent` 的 `DocumentReaderStrategy`。详见 [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md)。
- 普通 JSON / Form 请求必须走 `src/api/request.ts`，且需要登录态的请求必须保留 `credentials: 'include'`。详见 [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md)。
- Agent 流式接口是 `fetch + getReader + TextDecoder` 手动解析，不要直接替换成 `EventSource`。详见 [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md)。
- 后端 `Long` 实际返回字符串；ID 比较、表单回填、接口类型必须以运行时 payload 为准。详见 [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md)。
- 判断后端业务错误不要用 `message.includes('错误文本')` 字符串匹配，应检查后端返回的 `code` 字段。新增错误场景时优先在 `cloud-cold-agent` 的 `ErrorCode` 中定义错误码。

## 6. 本地开发及验证流程

1. 启动后端 `cloud-cold-agent`，默认地址 `http://localhost:8081/api`。
2. 安装依赖：`npm install`。
3. 启动前端：`npm run dev`。
4. 打开 Vite 输出的本地地址，通常是 `http://localhost:5173`。
5. 登录测试账号，确认 Cookie 正常携带。
6. 验证普通接口、Agent SSE、知识库 PDF 上传、HITL 和宠物记忆浮层（点击右下角云朵图标）。
7. 提交前运行 `npm run type-check` 和 `npm run build`。

curl 当前用户模板：

```bash
curl -b /tmp/cloud-cold-cookie.txt \
  http://localhost:8081/api/user/get/login
```

前端日志主要看浏览器 Console 和 Network；后端日志看 `cloud-cold-agent` 控制台。更多排查点见 [docs/development.md](docs/development.md)。

## 7. 质量检查

| 检查项 | 命令 | 说明 |
| --- | --- | --- |
| 类型检查 | `npm run type-check` | 当前最小验证 |
| 构建 | `npm run build` | 包含类型检查和 Vite 构建 |
| lint | `npm run lint` | 会自动修复并修改文件 |
| format | `npm run format` | 会格式化 `src/` |
| 预览 | `npm run preview` | 预览构建产物 |

## 8. 参考项目约定

参考优先级：

1. 当前仓库真实代码和运行时行为
2. `cloud-cold-agent` 的实际接口契约
3. [docs/design-docs/ref-frontend-architecture.md](docs/design-docs/ref-frontend-architecture.md)
4. Vue / Vite / TypeScript 官方约定

不要用 Vite 默认示例或 Ant Design Vue 默认组件风格覆盖当前主界面已经形成的业务结构和视觉语言。

## 9. 文档导航

| 文档 | 内容 |
| --- | --- |
| [README.md](README.md) | 人类快速上手和项目概览 |
| [docs/architecture.md](docs/architecture.md) | 分层架构、主页面状态、接口链路、宠物记忆组件 |
| [docs/development.md](docs/development.md) | 本地开发、请求地址、启动、验证、联调 |
| [docs/design-docs/ref-frontend-architecture.md](docs/design-docs/ref-frontend-architecture.md) | 参考项目架构说明 |
| [docs/design-docs/frontend-patterns.md](docs/design-docs/frontend-patterns.md) | 前端组件、请求、SSE、样式模式 |
