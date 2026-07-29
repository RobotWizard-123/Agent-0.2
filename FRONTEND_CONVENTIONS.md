# 前端开发规范 (FRONTEND_CONVENTIONS)

> **适用范围**: `frontend/` 目录下的全部 React + TypeScript 代码。
> 本规范是强制性的，所有 PR 必须遵守。ESLint + Prettier 会自动执行大部分规则。

---

## 1. 技术栈

| 层面 | 技术 | 版本 |
|------|------|------|
| 框架 | React | 18 |
| 语言 | TypeScript | 5.x |
| 构建 | Vite | 5.x |
| 状态管理 | Jotai | 2.x |
| 路由 | React Router | 6.x |
| 样式 | CSS Modules + 全局 CSS 变量 | — |
| 代码质量 | ESLint + Prettier | — |
| 测试 | Vitest + Testing Library | — |

## 2. 目录结构

```
frontend/src/
├── main.tsx                    # 应用入口 (ReactDOM.createRoot)
├── App.tsx                     # 根组件 (路由 + Provider)
├── types/                      # 全局类型定义
│   ├── domain.ts              # 领域模型 (Rack, Device, Plan, Alarm...)
│   ├── api.ts                 # API 请求/响应类型
│   └── common.ts              # 通用类型 (Route, Toast, Dialog...)
├── api/                        # API 层 (纯函数, 无 React 依赖)
│   ├── client.ts              # fetch 封装 + ApiError
│   └── endpoints.ts           # 按领域分组的端点函数
├── atoms/                      # Jotai atoms (全局状态)
│   ├── auth.ts                # 认证状态
│   ├── ui.ts                  # UI 状态 (路由, Toast, Dialog)
│   ├── room.ts                # 机房 + 机柜 + 告警
│   ├── plans.ts               # 计划 + 执行
│   ├── topology.ts            # 链路查询
│   ├── audit.ts               # 审计
│   ├── agent-status.ts        # Agent 探活
│   ├── settings.ts            # 部署策略
│   └── assistant.ts           # AI 助手
├── components/                 # 可复用组件
│   ├── ui/                    # 基础 UI 组件 (无业务逻辑)
│   └── layout/                # 布局组件
├── views/                      # 页面视图 (对应路由)
├── styles/                     # 全局样式
│   ├── tokens.css             # CSS 自定义属性 (设计令牌)
│   └── global.css             # 全局基础样式
└── utils/                      # 纯工具函数
```

### 目录职责规则

| 目录 | 允许依赖 | 禁止依赖 |
|------|----------|----------|
| `types/` | 无 | 任何其他目录 |
| `api/` | `types/` | React, Jotai, 组件 |
| `atoms/` | `types/`, `api/` | 组件, 视图 |
| `components/ui/` | `types/`, `utils/` | `atoms/`, `api/` (通过 props 传入) |
| `components/layout/` | `atoms/`, `components/ui/` | `views/` |
| `views/` | 全部 | 其他 views (通过路由跳转) |
| `utils/` | `types/` | 任何含业务逻辑的目录 |

## 3. 命名规范

### 文件命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件文件 | PascalCase.tsx | `MetricCard.tsx` |
| 类型文件 | kebab-case 或 camelCase.ts | `domain.ts` |
| Atom 文件 | kebab-case.ts | `agent-status.ts` |
| 工具文件 | kebab-case.ts | `rack-risk.ts` |
| CSS Module | PascalCase.module.css | `MetricCard.module.css` |
| 测试文件 | 与源文件同名 .test.tsx | `MetricCard.test.tsx` |

### 代码命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件 | PascalCase | `function MetricCard() {}` |
| 函数 | camelCase | `function formatPower() {}` |
| 变量 | camelCase | `const ratedPower = 1800` |
| 常量 | UPPER_SNAKE_CASE | `const STRATEGY_IDS = [...]` |
| 类型/接口 | PascalCase | `interface RackCapacity {}` |
| 枚举 | PascalCase + PascalCase 成员 | `enum PlanStatus { AwaitingConfirmation }` |
| Jotai atom | camelCase + Atom 后缀 | `const roomAtom = atom(...)` |
| 事件处理 | on + PascalCase | `onRackClick`, `onConfirm` |
| 布尔变量 | is/has/can 前缀 | `isOpen`, `hasAlarm`, `canExecute` |

## 4. TypeScript 规范

### 严格模式

`tsconfig.json` 启用 `strict: true`，禁止使用 `any`。

### 类型定义规则

```typescript
// ✅ 正确：使用 interface 定义对象形状
interface Rack {
  id: string;
  name: string;
  role: "server" | "network";
  capacity: RackCapacity;
}

// ✅ 正确：使用 type 定义联合类型
type RackRole = "server" | "network";
type RouteName = "overview" | "rack" | "agent" | "topology" | "alarms" | "audit";

// ✅ 正确：使用 enum 定义状态枚举
enum PlanStatus {
  Draft = "draft",
  Planned = "planned",
  Validated = "validated",
  AwaitingConfirmation = "awaiting_confirmation",
  Locked = "locked",
  Executing = "executing",
  Succeeded = "succeeded",
  Failed = "failed",
}

// ❌ 禁止：使用 any
function process(data: any) {}

// ❌ 禁止：使用 as 断言绕过类型检查 (除非有注释说明原因)
const rack = data as Rack;
```

### Props 类型定义

```typescript
// ✅ 组件 Props 必须使用 interface，以 Props 结尾
interface MetricCardProps {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "ok" | "warning" | "danger";
  source?: DataSource;
}

// ✅ 事件回调以 on 开头
interface RackCardProps {
  rack: Rack;
  alarms: Alarm[];
  onSelect: (rackId: string) => void;
}
```

### 导出规则

```typescript
// ✅ 类型使用 export interface / export type
export interface Rack { ... }

// ✅ 函数使用 export function / export const
export function formatPower(value: number): string { ... }

// ✅ 组件使用 export function (具名导出, 不用 default)
export function MetricCard({ label, value }: MetricCardProps) { ... }

// ✅ 常量使用 export const
export const STRATEGY_IDS = ["balanced_optimal", "consolidated", "load_balanced"] as const;
```

## 5. 组件规范

### 组件分类

| 类型 | 位置 | 职责 | 示例 |
|------|------|------|------|
| 基础组件 | `components/ui/` | 纯展示，无业务逻辑，通过 props 传入数据 | Button, Panel, Badge |
| 布局组件 | `components/layout/` | 页面骨架结构 | AppShell, Sidebar |
| 视图组件 | `views/` | 页面级组件，组合基础组件，读取 atoms | OverviewView |
| 助手组件 | `components/assistant/` | AI 助手专用组件 | AssistantPanel |

### 组件编写规则

```typescript
// ✅ 函数式组件，具名导出
interface ButtonProps {
  variant?: "primary" | "secondary" | "text";
  size?: "sm" | "md";
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}

export function Button({ variant = "primary", disabled, children, onClick }: ButtonProps) {
  return (
    <button
      className={styles.button}
      data-variant={variant}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ❌ 禁止：默认导出组件
export default function Button() {}

// ❌ 禁止：在组件内定义组件
export function Panel() {
  const Header = () => <div />; // 提取为独立组件
}

// ❌ 禁止：组件超过 300 行 (拆分为子组件)
```

### Props 规则

```typescript
// ✅ 可选 props 使用 ? 标记
interface PanelProps {
  title: string;           // 必填
  kicker?: string;         // 可选
  action?: React.ReactNode; // 可选
}

// ✅ 回调函数命名以 on 开头
interface ViewProps {
  onRackSelect: (rackId: string) => void;
  onAlarmTrigger: (scenario: string) => void;
}

// ✅ 不要透传 props (使用具体 props)
// ❌ 禁止
function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { ... }
// ✅ 正确
interface ButtonProps {
  variant: "primary" | "secondary";
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}
```

## 6. 状态管理规范 (Jotai)

### Atom 分类

| 类型 | 用途 | 创建方式 |
|------|------|----------|
| 基础 atom | 存储原始状态 | `atom(initialValue)` |
| 派生 atom | 从其他 atom 计算 | `atom((get) => ...)` |
| 写入 atom | action / 副作用 | `atom(null, (get, set, payload) => ...)` |

### Atom 命名

```typescript
// ✅ 基础 atom: camelCase + Atom 后缀
const roomAtom = atom<Room | null>(null);
const racksAtom = atom<Rack[]>([]);

// ✅ 派生 atom: camelCase + Atom 后缀，描述派生内容
const activeAlarmsAtom = atom((get) =>
  get(alarmsAtom).filter((a) => a.status !== "resolved")
);

// ✅ 写入 atom (action): camelCase + Action 后缀
const loginAction = atom(null, async (get, set, { username, password }: LoginInput) => {
  const session = await api.auth.login(username, password);
  set(sessionAtom, session);
});
```

### 使用规则

```typescript
// ✅ 在组件中使用 useAtomValue / useSetAtom
import { useAtomValue, useSetAtom } from "jotai";

function OverviewView() {
  const room = useAtomValue(roomAtom);
  const racks = useAtomValue(racksAtom);
  const refreshRoom = useSetAtom(refreshRoomAction);
  // ...
}

// ❌ 禁止：在组件中直接调用 API (必须通过 action atom)
function OverviewView() {
  const [room, setRoom] = useState(null);
  useEffect(() => {
    fetch("/api/room").then(setRoom); // ❌
  }, []);
}

// ✅ 正确：通过 action atom 封装 API 调用
const refreshRoomAction = atom(null, async (get, set) => {
  const room = await api.room.get();
  set(roomAtom, room);
});
```

### Atom 文件组织

每个领域一个文件，导出所有相关 atom：

```typescript
// atoms/room.ts
import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { Room, Rack, Alarm } from "../types/domain";

export const roomAtom = atom<Room | null>(null);
export const racksAtom = atom<Rack[]>([]);
export const alarmsAtom = atom<Alarm[]>([]);

export const activeAlarmsAtom = atom((get) =>
  get(alarmsAtom).filter((a) => a.status !== "resolved")
);

export const refreshRoomAction = atom(null, async (get, set) => {
  const [room, racks, alarms] = await Promise.all([
    api.room.get(),
    api.racks.list(),
    api.alarms.list(),
  ]);
  set(roomAtom, room);
  set(racksAtom, racks);
  set(alarmsAtom, alarms);
});
```

## 7. API 层规范

### 客户端封装

```typescript
// api/client.ts — 统一 fetch 封装
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function get<T>(path: string): Promise<T> { ... }
export async function post<T>(path: string, body?: unknown): Promise<T> { ... }
```

### 端点函数

```typescript
// api/endpoints.ts — 按领域分组
export const api = {
  auth: {
    login: (username: string, password: string) =>
      post<Session>("/api/auth/login", { username, password }),
    logout: () => post<Session>("/api/auth/logout"),
    session: () => get<Session>("/api/auth/session"),
  },
  room: {
    get: () => get<Room>("/api/room"),
  },
  racks: {
    list: () => get<Rack[]>("/api/racks"),
    detail: (id: string) => get<RackDetail>(`/api/racks/${id}`),
  },
  // ...
};
```

### 规则

- API 函数返回 `Promise<T>`，T 是具体的响应类型
- 路径参数使用模板字符串
- 请求体使用具体类型，不使用 `unknown`
- 错误统一抛出 `ApiError`，由调用方捕获

## 8. 样式规范

### 全局样式

- `styles/tokens.css`: CSS 自定义属性 (颜色、字体、间距等)
- `styles/global.css`: 全局重置、基础元素样式、工具类
- 全局样式通过 `main.tsx` 一次性导入

### CSS Modules

```typescript
// ✅ 组件使用 CSS Module
import styles from "./MetricCard.module.css";

export function MetricCard({ label, value, tone = "neutral" }: MetricCardProps) {
  return (
    <article className={`${styles.card} ${styles[`tone-${tone}`]}`}>
      <span className={styles.label}>{label}</span>
      <strong className={styles.value}>{value}</strong>
    </article>
  );
}
```

### CSS Module 规则

- 类名使用 kebab-case: `.metric-card`, `.tone-warning`
- 不使用 BEM (CSS Module 已提供作用域隔离)
- 动态类名使用模板字符串或 `clsx` 工具
- 媒体查询写在同一文件内

### 设计令牌使用

```css
/* ✅ 正确：使用 CSS 变量 */
.metric-card {
  background: var(--blueprint-800);
  border: 1px solid var(--line);
  color: var(--mist-100);
}

/* ❌ 禁止：硬编码颜色 */
.metric-card {
  background: #14232e;
  border: 1px solid rgba(159, 178, 186, 0.18);
  color: #dce7eb;
}
```

## 9. 路由规范

```typescript
// App.tsx
import { Routes, Route, Navigate } from "react-router-dom";

const routes = [
  { path: "/", element: <OverviewView /> },
  { path: "/rack/:rackId", element: <RackDetailView /> },
  { path: "/agent", element: <AgentConsoleView /> },
  { path: "/topology", element: <TopologyView /> },
  { path: "/alarms", element: <AlarmsView /> },
  { path: "/alarms/:alarmId", element: <AlarmsView /> },
  { path: "/audit", element: <AuditView /> },
] as const;
```

### 路由规则

- 使用 React Router v6 的 `createBrowserRouter` 或 `<Routes>`
- 路由路径使用 kebab-case
- 路由参数使用 camelCase: `:rackId`, `:alarmId`
- 导航使用 `useNavigate` hook，不使用 `<a>` 标签
- 路由变化时滚动到顶部

## 10. 错误处理规范

### API 错误

```typescript
// ✅ 在 action atom 中捕获 API 错误，设置 error atom
const createPlanAction = atom(null, async (get, set, request: PlanRequest) => {
  try {
    set(planLoadingAtom, true);
    set(planErrorAtom, null);
    const plan = await api.plans.create(request);
    set(currentPlanAtom, plan);
  } catch (error) {
    if (error instanceof ApiError) {
      set(planErrorAtom, { code: error.code, message: error.message });
    }
    throw error;
  } finally {
    set(planLoadingAtom, false);
  }
});
```

### 组件错误边界

```typescript
// ✅ 视图级错误边界
<ViewErrorBoundary>
  <OverviewView />
</ViewErrorBoundary>
```

### Toast 通知

```typescript
// ✅ 操作结果通过 Toast 反馈
const toastAtom = atom<Toast[]>([]);

const showToastAction = atom(null, (get, set, message: string, tone: ToastTone = "ok") => {
  const id = crypto.randomUUID();
  set(toastAtom, [...get(toastAtom), { id, message, tone }]);
  setTimeout(() => {
    set(toastAtom, (prev) => prev.filter((t) => t.id !== id));
  }, 3200);
});
```

## 11. 可访问性规范

- 所有交互元素使用 `<button>` 或 `<a>`，不使用 `<div onClick>`
- 按钮必须有 `aria-label` 或可见文本
- 图片必须有 `alt` 属性
- 表单字段必须有 `<label>` 关联
- 对话框使用 `role="dialog"` + `aria-modal="true"`
- 动态内容区域使用 `aria-live="polite"`
- 焦点管理: 对话框打开时聚焦首个交互元素
- 颜色对比度 ≥ WCAG AA 标准

## 12. 性能规范

- 组件使用 `React.memo` 仅在有性能问题时
- 列表项使用 `key` prop (唯一 ID，不用数组索引)
- 大列表考虑虚拟滚动
- 图片使用 `loading="lazy"`
- 避免在 render 中创建新对象/数组 (提取到 useMemo 或组件外)
- Jotai atom 拆分粒度: 只订阅需要的字段，避免订阅整个大对象

## 13. Git 提交规范

```
<type>(<scope>): <subject>

type:  feat | fix | refactor | style | docs | test | chore
scope: frontend | api | auth | rack | plan | alarm | assistant | topology | audit
```

示例:
```
feat(frontend): 迁移机房总览视图到 React
fix(rack): 修复 42U 四层视图设备重叠渲染问题
refactor(plan): 将计划状态管理从 useState 迁移到 Jotai
```

## 14. 禁止事项

1. **禁止** 使用 `any` 类型
2. **禁止** 使用 `export default` 导出组件
3. **禁止** 在组件中直接调用 `fetch`
4. **禁止** 在 `components/ui/` 中导入 `atoms/` 或 `api/`
5. **禁止** 硬编码颜色值 (必须使用 CSS 变量)
6. **禁止** 在 render 中执行副作用
7. **禁止** 使用 `useEffect` 进行数据获取 (使用 action atom)
8. **禁止** 组件超过 300 行 (拆分)
9. **禁止** 使用内联样式 `style={{}}` (除非动态计算值)
10. **禁止** 使用 `index` 作为列表 `key`
