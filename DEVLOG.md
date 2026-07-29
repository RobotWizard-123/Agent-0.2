# 开发日志 (DEVLOG)

> 本文件记录对机房智能管理 Agent V0.2 项目的所有改动，按时间倒序排列。
> 每次开发会话结束后追加一条记录。

---

## 2026-07-28 — React 前端架构迁移 + 规范包

**操作人**: opencode
**类型**: 前端架构改造

### 变更内容
- 创建 `FRONTEND_CONVENTIONS.md` 前端开发规范文档（14 章节：技术栈、目录结构、命名、TypeScript、组件、状态管理、API 层、样式、路由、错误处理、可访问性、性能、Git 提交、禁止事项）
- 创建 `frontend/` 目录，完整的 React + TypeScript + Vite + Jotai 前端项目
- 配置文件: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `index.html`
- 类型定义: `types/domain.ts` (全部领域模型), `types/api.ts` (请求/响应类型), `types/common.ts` (通用类型)
- API 层: `api/client.ts` (fetch 封装 + ApiError), `api/endpoints.ts` (按领域分组的端点函数)
- Jotai atoms (11 个文件): auth, ui, room, racks, plans, alarms, topology, audit, agent-status, settings, assistant
- 工具函数: `utils/format.ts` (formatPower, scoreValue, intervalText 等), `utils/rack-risk.ts` (rackRisk)
- UI 组件 (11 个): Button, Badge (StatusBadge + SourceBadge), Panel, ProgressBar, MetricCard, EmptyState, LoadingState, DetailList, Dialog, Toast, index.ts barrel export
- 布局组件 (4 个): AppShell, Sidebar, StatusStrip, LoginPanel
- AI 助手: AssistantPanel (完整迁移：launcher + panel + timeline + composer + proposal)
- 6 个视图全部迁移: OverviewView, RackDetailView, AgentConsoleView, TopologyView, AlarmsView, AuditView
- 入口文件: `main.tsx` (ReactDOM.createRoot), `App.tsx` (根组件：路由 + Provider + 认证 + Agent 轮询 + 助手初始化)
- 样式: 从 `public/css/` 复制 6 个 CSS 文件到 `frontend/src/styles/`，创建 `global.css` 统一导入

### 技术选型
- 框架: React 18 + TypeScript 5
- 构建: Vite 5 (dev proxy → 127.0.0.1:3000)
- 状态管理: Jotai 2 (atom-based, 细粒度订阅)
- 路由: 自定义路由 (routeAtom, 不使用 React Router, 保持与原项目一致的简单路由)
- 样式: 全局 CSS (保留原有设计系统, 不使用 CSS Modules)
- 代码质量: ESLint + Prettier

### 影响范围
- 新增目录: `frontend/` (完整 React 项目)
- 新增文件: `FRONTEND_CONVENTIONS.md`
- 不修改后端代码 (`src/`, `server.js` 等)
- 不修改原有前端 (`public/`) — 两套前端可并行存在

### 备注
- Vite 配置 `build.outDir: "../public"` — 构建产物直接输出到后端静态文件目录
- 开发时使用 `npm run dev` (Vite dev server, proxy 到后端)
- 生产时使用 `npm run build` (构建到 `public/`)
- 规范文档 `FRONTEND_CONVENTIONS.md` 是强制性的，所有 PR 必须遵守

---

## 2026-07-28 — 初始化项目记忆

**操作人**: opencode
**类型**: 文档初始化

### 变更内容
- 完整审查项目全部源码（server.js + src/ 21 个子模块 + public/ 前端 + tests/ 34 个测试 + data/ + deploy/ + scripts/）
- 创建 `AGENTS.md` 长期记忆文件，记录项目整体架构、核心原理、API 路由、错误码、演示数据、开发注意事项等
- 创建本文件 `DEVLOG.md` 作为开发日志

### 影响范围
- 新增文件: `AGENTS.md`, `DEVLOG.md`
- 无代码变更

### 备注
- 项目当前版本 0.2.0，零运行时依赖，纯 Node.js 22+ ESM
- 后续每次开发会话的改动都会追加到本文件
