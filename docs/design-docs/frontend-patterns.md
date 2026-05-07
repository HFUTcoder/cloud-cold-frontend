# 前端组件使用模式

本文记录 `cloud-cold-frontend` 中应继续遵守的组件、请求、SSE 和样式模式。

## 请求模式

- 普通 JSON 接口统一放在 `src/api/*`。
- 通用请求必须走 `src/api/request.ts`。
- Form 上传继续走 `requestForm(...)`。
- 页面不要散落通用 `fetch` 细节。
- 需要登录态的请求必须保留 `credentials: 'include'`。

## SSE 模式

- Agent 流式接口继续由 `src/api/agent.ts` 管理。
- 当前解析方式是 `fetch + getReader + TextDecoder`。
- 不要直接替换为 `EventSource`，因为当前请求需要 POST body、Cookie 和 AbortSignal。
- SSE 事件名当前固定为 `agent`。
- 新增事件类型时，要同步 `src/types/agent.ts`、`HomeView.vue` 和后端事件工厂。

## 类型模式

- 新接口字段优先补到 `src/types/*`。
- 运行时 payload 优先于 TypeScript 旧注解。
- 特别注意后端 `Long` 当前会以字符串返回。
- 文档状态值继续从 `src/constants/document.ts` 引用。
- Agent 模式值继续从 `src/constants/agent.ts` 引用。

## 页面与组件模式

- 聊天主流程优先在 `HomeView.vue` 的现有结构上做局部修改。
- 知识库工作台逻辑继续留在 `KnowledgeWorkspace.vue`。
- 宠物记忆逻辑继续留在 `PetMemoryWidget.vue`。
- 新增独立块时再考虑拆组件。
- 不要把知识库或长期记忆的大段逻辑重新塞回首页脚本里。

## 样式模式

- 当前主界面高度依赖自定义 CSS 视觉语言。
- Ant Design Vue 已注册，但主界面不是 Antd 组件树。
- 新增 UI 要保持现有视觉一致性。
- 不要因为存在 Antd 就混入大量未协调的 `<a-button>`、`<a-form>` 等组件。

## 业务边界模式

- `/about` 和默认示例组件不是业务入口。
- 知识库工作台不是独立路由。
- 宠物记忆浮层不是装饰组件。
- Skill 菜单加载和 Skill 绑定不是同一件事。
- Skill 绑定不会自动建会话，知识库绑定会自动建会话。
- 当前上传只支持 PDF。
