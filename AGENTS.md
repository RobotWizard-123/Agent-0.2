# AGENTS.md - 机房智能管理 Agent V0.2 项目记忆

> **开发日志**: 每次开发会话的改动记录在 `DEVLOG.md` 中（按时间倒序）。每次开发完成后必须追加一条记录。

## 项目概述

**名称**: datacenter-mgr (lenovo-agent2-codex-datacenter-agent-v0.2)
**版本**: 0.2.0
**描述**: 面向领导演示的机房智能管理 MVP，用确定性规则完成设备上架、容量判断、链路查询、变更确认、报警诊断、恢复验证和审计。
**技术栈**: 纯 Node.js 22+ (ESM)，零运行时依赖，前端 React 18 + TypeScript + Vite + Jotai (新)
**前端规范**: `FRONTEND_CONVENTIONS.md` — React 前端开发规范（强制执行）
**前端目录**: `frontend/` — React + TypeScript + Vite + Jotai 项目
**测试**: `node --test` (单元) + Playwright (E2E)
**启动**: `npm start` 或 `node run-demo.js` (一键启动器，自动拉起模拟模型)

## 关键命令

```powershell
npm install              # 安装 devDependencies (仅 playwright)
npm run reset:demo       # 重置演示数据到标准种子
npm start                # 启动服务 (默认 127.0.0.1:3000)
npm test                 # 运行单元测试 (node --test)
npm run test:e2e         # 运行 E2E 测试 (Playwright)
npm run test:all         # 运行全部测试
node run-demo.js         # 一键启动 (自动配置环境变量+模拟模型+浏览器)
node run-demo.js --real  # 强制使用 .env 中的真实模型
```

## 环境变量 (.env)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| AGENT_BASE_URL | 私有模型 API 地址 | 空(不配置则规则降级) |
| AGENT_API_KEY | 模型 API Key | 空 |
| AGENT_MODEL | 模型名称 | 空 |
| AGENT_TIMEOUT_MS | 模型调用超时 | 8000 |
| HOST | 监听地址 | 127.0.0.1 |
| PORT | 监听端口 | 3000 |
| SESSION_SECRET | 会话签名密钥 | 必填 |
| APP_ADMIN_PASSWORD | 管理员密码 | 必填 |
| APP_VIEWER_PASSWORD | 只读查看者密码 | 必填 |
| TRUST_PROXY_HTTPS | 是否信任 HTTPS 代理 | false |

## 项目目录结构

```
lenovo-agent2-codex-datacenter-agent-v0.2/
├── server.js                    # 入口：组装 repository + agentGateway + auth → createServerApp
├── package.json                 # 零运行时依赖，type: module
├── Dockerfile                   # node:22-alpine, 非 root 运行
├── compose.yaml                  # app + nginx(可选 https profile)
├── run-demo.js                  # 一键启动器(自动配置+模拟模型+浏览器)
├── data/
│   ├── seed/state.json          # 标准种子数据 (由 createDemoState 生成)
│   ├── runtime/state.json       # 运行时状态 (原子写入, 版本化)
│   └── *.json                   # 遗留数据文件 (topology/cabinets/servers/batches/deployments, 已被 state.json 取代)
├── src/
│   ├── config.js                # 环境变量解析 → getAgentConfig/getAuthConfig/getRuntimeConfig
│   ├── http-app.js              # ★ HTTP 应用组装中心：创建所有服务实例、注册路由、中间件链
│   ├── data-store.js            # 遗留数据读取 (已基本不用)
│   ├── demo-state.js             # ★ 演示状态工厂：22 柜 + JG1/JG2/KT1 电源 + 网络拓扑
│   ├── demo-occupancy.js         # 演示设备占用生成器：按机柜生成设备+电源/网络连接
│   ├── deploy-agent.js           # 遗留预检查 (runPrecheck, 已被 plan-service 取代但仍用于 /api/deploy/precheck)
│   ├── placement-recommender.js  # 遗留推荐接口 (recommendPlacement, 适配旧 API 到新 planning-engine)
│   ├── adopt-placement.js        # 遗留批量上架 (已禁用, 返回 410)
│   ├── batch-engine.js           # 遗留批量引擎 (已禁用)
│   ├── domain/                   # ★ 领域核心：约束引擎 + 容量计算 + 机柜布局
│   │   ├── constraint-engine.js  #   硬约束验证：place/move/remove/set_dividers/set_service_health
│   │   ├── capacity.js            #   容量快照：功率/U位/重量/端口
│   │   └── rack-layout.js        #   42U 四层布局：deriveLayers/packDevices/freeIntervals
│   ├── planning/                 # ★ 规划引擎：候选生成 + 策略评分
│   │   ├── planning-engine.js    #   推荐入口：normalizeRequest → generate → score → sort
│   │   ├── candidate-generator.js #   候选生成：beam search + 隔板调整 + 副本域检查
│   │   ├── migration-planner.js  #   迁移规划：当无直接候选时尝试迁移腾位
│   │   ├── strategy-profiles.js  #   三种策略权重定义 + 权重倍率验证
│   │   └── strategy-scorer.js     #   评分器：9 维指标 × 策略权重 → 加权平均分
│   ├── workflows/                # ★ 工作流：计划生命周期
│   │   ├── plan-service.js       #   计划服务：create→validate→confirm→execute→verify (624行, 核心文件)
│   │   └── simulated-execution-adapter.js # 模拟执行适配器：lock→write→verify, 失败回滚
│   ├── agent/                    # ★ AI Agent 网关
│   │   ├── agent-gateway.js      #   LLM 网关：extractRequest/adjustPlan/answerAssistant/health
│   │   ├── agent-schema.js       #   响应验证：设备请求/计划调整/动作验证
│   │   ├── agent-status.js       #   探活缓存：10s TTL, 避免频繁请求模型
│   │   ├── rule-extractor.js     #   规则降级抽取器：正则提取设备参数
│   │   └── dns-aware-fetch.js    #   DNS 感知 fetch：手动解析 IPv4, 限制响应大小
│   ├── assistant/                # ★ 全站 AI 助手
│   │   ├── assistant-orchestrator.js # 助手编排：modelAnswer → proposalFor → sessionStore
│   │   ├── context-service.js    #   上下文构建：机柜/设备/链路/告警/方案/审计 → 安全快照
│   │   ├── action-bridge.js       #  动作桥接：proposal → planService.create / diagnosisEngine
│   │   ├── deterministic-assistant.js # 确定性降级助手：正则匹配机柜/设备/告警/方案
│   │   ├── assistant-schema.js   #   助手响应验证：answer/evidence/intent
│   │   ├── feedback-detector.js  #   反馈检测：快照 diff → 事件流
│   │   └── session-store.js      #   会话存储：消息/提案/反馈事件/限流
│   ├── alarms/                   # 报警引擎
│   │   ├── alarm-engine.js       #   报警生命周期：trigger→acknowledge→diagnose→resolve
│   │   └── diagnosis-engine.js   #   诊断引擎：diagnose→createRemediation→confirmRemediation
│   ├── auth/
│   │   └── session-auth.js       # 会话认证：HMAC 签名 Cookie, HttpOnly+SameSite=Strict
│   ├── http/
│   │   ├── router.js             # 简易路由：模式匹配 + JSON 读写 + 1MB 限制
│   │   └── routes/               # 10 个路由模块
│   │       ├── inventory-routes.js   # GET /api/room, /api/racks, /api/racks/:id, /api/devices/:id, /api/capacity, /api/config/status
│   │       ├── topology-routes.js    # GET /api/topology/devices/:id, /api/topology/power, /api/topology/network
│   │       ├── plan-routes.js       # POST /api/plans, GET /api/plans/:id, POST /api/plans/:id/confirm, POST /api/plans/:id/select-candidate
│   │       ├── alarm-routes.js      # GET /api/alarms, POST /api/alarms/:id/acknowledge|diagnose|remediation
│   │       ├── demo-routes.js       # POST /api/demo/alarms, /api/demo/reset
│   │       ├── audit-routes.js      # GET /api/audit
│   │       ├── auth-routes.js       # POST /api/auth/login|logout, GET /api/auth/session
│   │       ├── health-routes.js     # GET /health/live, /health/ready
│   │       ├── agent-routes.js      # GET /api/agent/status
│   │       └── assistant-routes.js   # GET /api/assistant/session|feedback, POST /api/assistant/messages, POST /api/assistant/proposals/:id/plans
│   ├── repositories/
│   │   └── state-repository.js   # JSON 仓库：原子写入(.tmp→rename) + 乐观锁(version)
│   ├── settings/
│   │   └── placement-settings-service.js # 部署策略默认值管理
│   ├── telemetry/
│   │   └── demo-telemetry-provider.js    # 演示遥测(未接入真实采集)
│   └── topology/
│       └── topology-service.js   # 链路查询：设备→电源路径 + 网络路径
├── public/                       # 前端 (原生 JS, 无框架)
│   ├── index.html                # SPA 入口
│   ├── css/                      # 6 个 CSS 文件
│   │   ├── tokens.css            # 设计令牌
│   │   ├── style.css             # 主样式入口
│   │   ├── layout.css            # 布局
│   │   ├── components.css        # 组件
│   │   ├── views.css             # 视图
│   │   └── assistant.css         # AI 助手面板
│   └── js/
│       ├── app.js                # 应用入口：路由渲染 + 登录 + Agent 状态轮询
│       ├── api.js                # fetch 封装 + ApiError
│       ├── state.js              # 全局状态管理 (pub/sub)
│       ├── components.js          # UI 组件库：h() DOM 构建 + panel/metricCard/progressBar 等
│       ├── rack-risk.js          # 机柜风险计算
│       ├── assistant-client.js   # AI 助手客户端：消息/反馈/提案
│       ├── assistant-panel.js    # AI 助手面板 UI
│       └── views/
│           ├── overview.js       # 机房总览：22 柜平面 + 功率母线 + 网络路由
│           ├── rack-detail.js    # 机柜详情：42U 四层视图 + 设备抽屉
│           ├── agent-console.js  # 上架 Agent：自然语言 + 结构化表单
│           ├── placement-plan.js # 方案展示：候选卡片 + 评分分解 + 最终确认对话框
│           ├── topology.js       # 链路查询：设备/机柜/电源/交换机
│           ├── alarms.js         # 报警诊断：触发→诊断→处置→恢复
│           └── audit.js          # 变更审计：时间线 + 重置
├── tests/                        # 34 个测试文件
│   ├── helpers.js                # 测试辅助：withV02Server/withAuthenticatedServer
│   └── e2e/                      # Playwright E2E 测试
├── scripts/
│   ├── reset-demo-data.js        # 重置种子数据
│   ├── mock-agent-server.js      # 本地模拟模型服务
│   ├── run-e2e.js                # E2E 测试启动器
│   ├── start-acceptance-stack.js # 验收测试栈
│   ├── start-e2e-stack.js       # E2E 测试栈
│   └── diagnose-agent.js         # Agent 诊断脚本
├── deploy/
│   └── nginx.conf                # Nginx 反向代理配置 (HTTPS profile)
└── docs/superpowers/
    ├── plans/                    # 实施计划文档
    └── specs/                    # 设计规格文档
```

## 核心架构原理

### 1. 状态管理：版本化 JSON 仓库

- **数据存储**: `data/seed/state.json` (种子) → `data/runtime/state.json` (运行时)
- **原子写入**: 先写 `.tmp` 文件再 `rename`，防止写入中断导致数据损坏
- **乐观锁**: 每次修改必须传入 `expectedVersion`，版本不匹配抛 `STATE_VERSION_CONFLICT`
- **版本递增**: 每次 `mutate()` 后 `version + 1`
- **深拷贝**: 所有读取返回 `structuredClone`，防止外部修改内部状态
- **重置**: `repository.reset()` 恢复种子数据

### 2. 领域模型：42U 四层机柜

- **机柜**: 42U 高度，3 个分隔点 `[12, 22, 32]` → 4 层 (L01~L04)
- **每层预留**: 每层末尾保留 2U 不可占用 (`reserve_u_per_layer: 2`)
- **层容量**: L01=12U, L02=10U, L03=10U, L04=10U (各减 2U 预留)
- **10U 限制**: 10U 设备强制放在 L01
- **设备上限**: 最大 10U
- **网络柜**: 不允许放置服务器

### 3. 硬约束引擎 (constraint-engine.js)

动作类型:
- `place_device`: 上架设备 (检查功率/U位/重量/端口/层位/重叠/预留)
- `move_device`: 迁移设备 (检查可移动性/关键性/维护窗口)
- `remove_device`: 取出设备 (检查可移动性/关键性/副本组/维护窗口)
- `set_dividers`: 调整隔板 (仅允许调整 L02~L04 的分隔点)
- `set_service_health`: 设置服务健康状态
- `clear_demo_condition`: 清除演示故障条件

约束检查:
- 功率: 额定功率 > 设计容量 → blocker; ≥80% → warning
- 重量: > 最大承重 → blocker; ≥80% → warning
- 端口: > 端口上限 → blocker; ≥80% → warning
- U 位: 跨层/重叠/占用预留区 → blocker
- 副本域: 同一副本组不能共享电源或网络交换机
- 迁移: 不可移动/关键设备/无维护窗口 → blocker

### 4. 规划引擎 (planning-engine.js)

**三种策略**:
| 策略 ID | 名称 | 特点 |
|---------|------|------|
| balanced_optimal | 综合最优 | 兼顾业务邻近、空间连续性与容量水位 |
| consolidated | 集中部署 | 优先复用已启用机柜，减少新柜启用 |
| load_balanced | 负载均衡 | 优先平衡机柜容量与上游电源负载 |

**9 维评分指标**:
preferred(优选机柜), business(业务邻近), fragmentation(空间连续性), link(链路邻近), capacity(容量水位), growth(扩容空间), activation(新柜启用), source_imbalance(电源均衡), migration(迁移代价)

**候选生成流程**:
1. `generatePlacementCandidates`: beam search (maxBeams=64) 遍历所有机柜×层×空闲区间
2. 若无直接候选 → 尝试隔板调整
3. 若仍无候选 → `generateMigrationCandidates`: 迁移现有设备腾位
4. 每个候选经 `evaluateActions` 硬约束验证
5. `scoreCandidate` 按策略权重加权评分
6. 按 score 升序排列 (分数越低 = 越优)

### 5. 计划工作流 (plan-service.js)

**状态机**:
```
draft → planned → validated → awaiting_confirmation → locked → executing → succeeded/failed
```

**关键规则**:
- **一次确认**: `confirmation_count` 最大为 1，确认后不可再次确认
- **快照版本**: 计划创建时记录 `snapshot_version`，确认时检查 `state.version === snapshot_version`，不匹配抛 `PLAN_STALE`
- **确认前重验**: 确认时用当前状态重新 `evaluateActions`，不通过抛 `PLAN_BLOCKED`
- **执行三阶段**: lock → write → verify，任一阶段失败回滚
- **执行成功**: 替换 inventory (racks/devices/connections)
- **执行失败**: 状态回滚，生成告警，保留审计记录
- **Agent 干预**: `applyBoundedAgentIntervention` — Agent 可重排候选/调整权重/提供替代方案，但不能修改设备事实/机柜容量/硬约束结果

**计划类型**:
- `placement`: 上架设备
- `natural_language`: 自然语言描述 (先抽取设备参数再走 placement)
- `alarm_remediation`: 告警处置
- `removal`: 设备取出
- `change`: 通用变更

### 6. Agent 网关 (agent-gateway.js)

- **协议**: OpenAI 兼容 `/v1/chat/completions`
- **三个功能**: `extractRequest` (自然语言→设备参数), `adjustPlan` (计划调整), `answerAssistant` (助手问答)
- **Fail-fast 机制**: 模型不可达时缓存失败状态 (TTL = timeoutMs)，避免每次请求都等待超时
- **DNS 感知 fetch**: 手动解析 IPv4，限制响应 2MB，HTTPS 验证证书
- **响应验证**: 所有模型返回经 `agent-schema.js` 严格验证，越界响应被拒绝
- **降级链**: 模型不可用 → 规则抽取器 (`rule-extractor.js`) → 结构化表单

### 7. 全站 AI 助手 (assistant/)

- **上下文构建** (`context-service.js`): 构建安全快照 (机柜+设备+链路+告警+方案+审计+运行时状态)
- **模型调用**: 有 Agent → LLM 回答; 无 Agent → `deterministic-assistant.js` 规则回答
- **提案系统**: 助手可生成 `propose_placement` / `propose_remediation` 提案 → `action-bridge.js` 转为计划
- **反馈检测** (`feedback-detector.js`): 快照 diff 检测告警/容量/约束/依赖变化 → 事件流
- **会话存储**: 内存 Map，每会话最多 20 轮对话，10 次/分钟限流，200 条反馈事件
- **30 秒轮询**: 前端每 30s 拉取反馈事件

### 8. 报警系统 (alarms/)

**5 种演示场景**:
| 场景 | 严重度 | 对象 | 触发码 |
|------|--------|------|--------|
| power_high | warning | rack/CAB-01 | RACK_POWER_HIGH |
| placement_conflict | critical | rack/CAB-09 | PLACEMENT_CONFLICT |
| collector_offline | critical | service/collector | COLLECTOR_OFFLINE |
| model_offline | warning | service/model | MODEL_SERVICE_OFFLINE |
| execution_failure | critical | service/execution-adapter | SIMULATED_EXECUTION_FAILED |

**报警状态机**:
```
open → acknowledged → diagnosing → action_pending → executing → resolved
                                                    ↑                ↓
                                                    └─── failed ─────┘
```

**恢复验证**: 报警不能直接标记为恢复，必须执行处置后触发条件确实消失才自动 resolve

### 9. 认证 (auth/session-auth.js)

- **两种角色**: admin (可执行写操作), viewer (只读)
- **会话**: HMAC-SHA256 签名的 Cookie (`dc_session=sessionId.signature`)
- **Cookie 属性**: HttpOnly, SameSite=Strict, Max-Age=12h, 可选 Secure
- **同源校验**: 所有 POST 请求校验 `Origin === Host`，防止 CSRF
- **密码比较**: `timingSafeEqual` 防时序攻击
- **公开路由**: `/api/auth/login`, `/api/auth/session`, `/api/agent/status` 不需要认证

### 10. 前端架构

- **无框架**: 原生 ES Modules，`h()` 函数构建 DOM
- **状态管理**: 简单 pub/sub 模式 (`state.js`)
- **6 个视图**: overview, rack, agent, topology, alarms, audit
- **AI 助手面板**: 悬浮面板，30s 轮询反馈，可生成提案
- **Agent 状态轮询**: 每 15s 探活，顶部 badge 显示真实连通状态

## API 路由总览

### 公开路由
- `GET /health/live` — 进程存活
- `GET /health/ready` — 核心仓库可读 + 模型/采集器降级状态
- `POST /api/auth/login` — 登录
- `GET /api/auth/session` — 当前会话
- `GET /api/agent/status` — Agent 真实连通状态 (10s 缓存)

### 需要认证 (viewer+)
- `GET /api/room` — 机房信息
- `GET /api/racks` — 机柜列表 (含容量快照)
- `GET /api/racks/:id` — 机柜详情 (含 42U 四层视图)
- `GET /api/devices/:id` — 设备详情
- `GET /api/capacity` — 全部机柜容量
- `GET /api/config/status` — 运行时配置
- `GET /api/cabinets` — 机柜列表 (原始)
- `GET /api/servers` — 设备列表 (原始)
- `GET /api/topology/devices/:id` — 设备链路
- `GET /api/topology/power` — 强电拓扑
- `GET /api/topology/network` — 弱电拓扑
- `GET /api/plans/:id` — 计划详情
- `GET /api/alarms` — 报警列表
- `GET /api/alarms/:id` — 报警详情
- `GET /api/audit` — 审计记录
- `GET /api/settings/placement-strategy` — 部署策略
- `GET /api/assistant/session` — 助手会话
- `GET /api/assistant/feedback` — 助手反馈
- `POST /api/auth/logout` — 登出

### 需要管理员 (admin)
- `POST /api/plans` — 创建计划
- `POST /api/plans/:id/confirm` — 确认执行计划
- `POST /api/plans/:id/select-candidate` — 切换候选
- `POST /api/settings/placement-strategy` — 修改默认策略
- `POST /api/alarms/:id/acknowledge` — 确认报警
- `POST /api/alarms/:id/diagnose` — 诊断报警
- `POST /api/alarms/:id/remediation` — 生成处置方案
- `POST /api/demo/alarms` — 触发演示报警
- `POST /api/demo/reset` — 重置演示数据
- `POST /api/assistant/messages` — 发送助手消息
- `POST /api/assistant/proposals/:id/plans` — 从提案生成计划

### 已禁用 (返回 410)
- `POST /api/agent/adopt-placement`
- `POST /api/deploy/batch`
- `GET /api/deploy/batches`
- `GET /api/deploy/batches/:id`
- `POST /api/deploy/batches/:id/poll`
- `POST /api/deploy/batches/:id/action`

## 错误码映射

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| INVALID_JSON | 400 | 请求体不是有效 JSON |
| AGENT_INPUT_INVALID | 400 | Agent 输入无效 |
| PLACEMENT_STRATEGY_INVALID | 400 | 未知部署策略 |
| ASSISTANT_INPUT_INVALID | 400 | 助手消息无效 |
| AUTH_REQUIRED | 401 | 需要登录 |
| INVALID_CREDENTIALS | 401 | 用户名或密码错误 |
| FORBIDDEN | 403 | 权限不足 |
| ORIGIN_MISMATCH | 403 | 同源校验失败 |
| *_NOT_FOUND / PLAN_NOT_FOUND | 404 | 资源不存在 |
| STATE_VERSION_CONFLICT | 409 | 状态版本冲突 |
| PLAN_STALE | 409 | 计划基于过期状态 |
| PLAN_ALREADY_CONFIRMED | 409 | 计划已确认 |
| PLAN_NOT_CONFIRMABLE | 409 | 计划不可确认 |
| ASSISTANT_BUSY | 409 | 助手正忙 |
| ASSISTANT_PROPOSAL_USED | 409 | 提案已使用 |
| ASSISTANT_RATE_LIMITED | 429 | 助手限流 |
| PLAN_BLOCKED | 422 | 计划被硬约束阻断 |
| AGENT_RESPONSE_INVALID | 422 | Agent 响应无效 |
| ASSISTANT_PROPOSAL_INVALID | 422 | 提案无效 |
| LEGACY_BATCH_DISABLED | 410 | 遗留接口已禁用 |
| REQUEST_TOO_LARGE | 413 | 请求体超过 1MB |
| AGENT_UNAVAILABLE | 503 | Agent 不可用 |
| AUTH_NOT_CONFIGURED | 503 | 认证未配置 |
| 其他 | 500 | 内部错误 |

## 演示数据 (L5-A2-08 机房)

- **22 个机柜**: CAB-01~CAB-20 (服务器柜), CAB-21~CAB-22 (网络柜)
- **2 排布局**: 1~11 在第 1 排, 12~22 在第 2 排
- **3 条电源母线**: JG1 (CAB-01~10, 10kW/20kW), JG2 (CAB-11~20, 20kW/10kW), KT1 (CAB-21~22, 5kW)
- **10 台接入交换机**: ASW-01~ASW-10, 每台连接 2 个机柜
- **核心交换机**: CORE-01
- **演示设备**: SRV-DEMO-10U (CAB-09, 10U GPU), SRV-DEMO-4U (CAB-11), SRV-DEMO-2U (CAB-14)
- **副本组**: RG-DEMO-01 (CAB-03 + CAB-14, database-platform)

## Docker 部署

```powershell
# 构建+启动
docker compose build app
docker compose up -d app

# HTTPS 模式 (需要证书)
docker compose --profile https up -d

# 数据卷: datacenter-runtime → /app/data/runtime
# 健康检查: /health/ready (20s 间隔)
```

## 测试

- **单元测试**: `npm test` (node --test, 34 个文件)
- **E2E 测试**: `npm run test:e2e` (Playwright, tests/e2e/)
- **测试辅助**: `tests/helpers.js` — `withV02Server` / `withAuthenticatedServer`
- **浏览器**: Windows 默认 Edge, Linux 需 `npx playwright install chromium`
- **截图/跟踪**: `output/playwright/`

## 开发注意事项

1. **零依赖**: 项目不使用任何运行时 npm 依赖，仅 devDependencies 有 playwright
2. **ESM**: 所有文件使用 `import/export`，`package.json` 中 `"type": "module"`
3. **深拷贝**: 所有状态读取返回 `structuredClone`，不要直接修改 repository 返回值
4. **版本控制**: 所有状态修改必须通过 `repository.mutate(expectedVersion, mutator)` 
5. **错误处理**: 使用 `Object.assign(new Error(msg), { code, ...details })` 模式
6. **安全**: 不提交 `.env`，不记录密钥/密码，写请求校验同源
7. **数据来源**: 每个数据对象都有 `data_source` 字段 (design/rule/demo/telemetry/unknown)
8. **冗余不声明**: 未核实的 A/B 冗余标记为 `unverified`，不虚构链路
9. **遗留代码**: `data-store.js`, `batch-engine.js`, `adopt-placement.js`, `deploy-agent.js`, `placement-recommender.js` 为遗留代码，新功能不应使用
10. **前端无框架**: 使用 `h()` 函数构建 DOM，不要引入 React/Vue 等

## 领导演示流程

1. 登录管理员 → 机房总览 (22 柜、设计容量、功率母线)
2. 点击 CAB-09 → 42U 四层视图、每层 2U 预留、GPU 服务器明细
3. 上架 Agent → 选择三种策略 → 4U 设备 → 比较规则基线与 Agent 评分
4. 最终确认 → 快照版本、动作清单、回滚边界 → 执行 → 验证
5. 链路查询 → SRV-DEMO-10U → 电源/网络证据 → "冗余未核实"
6. 报警诊断 → 模拟功率过高 → Agent 诊断 → 处置方案 → 最终确认 → 恢复验证
7. 变更审计 → 策略/Agent 干预/执行/恢复记录 → 重置演示数据
