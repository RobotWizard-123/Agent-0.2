# CP-SAT 服务器上架求解器设计

## 状态与目标

本设计于 2026-07-28 确认，用 Google OR-Tools CP-SAT 优化服务器直接上架和批量上架候选生成。

目标是：

- 在真实连续空闲 U 位中搜索精确起始位置，而不是只检查每个空闲区间的起点。
- 同时处理批量设备的 U 位冲突、功率、重量、端口和副本故障域约束。
- 根据综合最优、集中部署和负载均衡三种策略生成最多 4 个不同候选。
- 保留现有确定性风险引擎作为最终安全边界。
- 保留计划生成、一次最终确认、模拟执行和审计闭环。
- CP-SAT 不可用时自动回退现有 Beam Search，网站仍可使用。

第一阶段不把隔板调整和跨机柜迁移纳入 CP-SAT。CP-SAT 没有直接上架解时，继续使用现有隔板与迁移逻辑。

## 方案选择

评估过三种接入方式：

1. Node.js 每次规划时调用本地 Python CLI。
2. 独立部署常驻 Python HTTP 求解服务。
3. 使用非官方 OR-Tools WebAssembly 版本。

第一阶段选择 Python CLI 适配器。它能保持当前同步 `planningEngine.recommend()` 接口，改动面最小，并且使用 Google 官方 Python 包。每次启动 Python 进程会增加少量开销，但当前机房规模和 2 秒求解预算可以接受。

当规划并发量增长后，可以保持相同 JSON 契约，把 CLI 适配器替换为常驻 HTTP 求解服务。

## 运行与部署

- Python 版本：3.11 或更高。
- OR-Tools 版本：`ortools==9.15.6755`。
- Node.js 继续作为网站和业务规则主进程。
- 本地开发时，开发电脑需要 Python 和 OR-Tools。
- 正式部署时，Node.js、Python 和 OR-Tools 一起封装进服务器容器；远程访问网页的电脑不需要 Python。
- `CP_SAT_PYTHON` 指向明确的解释器路径，Windows 可配置为 `.venv\Scripts\python.exe`，Linux 容器可配置为 `/opt/venv/bin/python`。

环境配置：

```dotenv
CP_SAT_ENABLED=true
CP_SAT_PYTHON=.venv\Scripts\python.exe
CP_SAT_TIMEOUT_MS=2500
```

Python 内部总求解预算为 2 秒，Node.js 进程超时为 2.5 秒，为 Python 启动和 JSON 传输保留 0.5 秒。

## 组件边界

### `src/planning/cp-sat-slots.js`

负责把规范化机房快照转换为求解输入：

- 调用现有 `freeIntervals()` 获得每层真实连续空闲区间。
- 对每个区间枚举所有合法起始 U 位。
- 排除网络柜、越界位置、预留区和 10U 非 L01 位置。
- 计算每个机柜的剩余功率、剩余重量和剩余端口。
- 提供电源源、交换机、业务邻近和当前机柜启用状态。
- 根据所选策略，把现有 0–100 归一化指标转换为整数软成本。

该模块不决定候选是否最终安全，只负责生成有限、确定、可验证的求解输入。

### `src/planning/cp-sat-adapter.js`

负责 Node.js 与 Python 的进程边界：

- 使用固定脚本路径和 `spawnSync`/`execFileSync`，并设置 `shell:false`。
- 通过标准输入传输 JSON，通过标准输出接收 JSON。
- 限制输入、输出、执行时间和候选数量。
- 校验 Python 返回的状态、候选结构、机柜、层、起始 U 位和设备索引。
- 把合法放置结果转换为现有 `place_device` 动作。
- 对每个候选调用现有 `evaluateActions()` 完整复核。
- 对异常返回稳定错误码，不向 UI 暴露 Python 堆栈。

适配器支持注入进程运行器，便于 Node.js 单元测试模拟正常、超时、缺少依赖和非法输出。

### `solver/cp_sat_solver.py`

负责构造和求解 CP-SAT 模型：

- 从标准输入读取一份 JSON 请求。
- 使用 OR-Tools `CpModel` 创建布尔分配变量和容量约束。
- 在总计 2 秒内依次寻找并排除重复解。
- 最多返回 4 个不同候选。
- 使用固定随机种子 `20260728` 和单工作线程，保证相同输入得到稳定结果。
- 只向标准输出写一份 JSON；诊断信息写入标准错误且不包含完整输入。

### `src/planning/planning-engine.js`

规划编排顺序调整为：

1. 规范化请求并校验设备尺寸。
2. CP-SAT 已启用时生成直接上架候选。
3. 对 CP-SAT 候选运行现有风险校验和策略评分。
4. CP-SAT 技术故障时使用 Beam Search 生成直接候选。
5. 没有直接候选时进入现有隔板调整和迁移流程。
6. 按现有评分规则排序并最多返回 4 个候选。

## JSON 契约

Node.js 发给 Python 的请求只包含求解需要的数据：

```json
{
  "schema_version": 1,
  "strategy_id": "balanced_optimal",
  "max_candidates": 4,
  "time_limit_ms": 2000,
  "request": {
    "id": "SRV-NEW",
    "count": 2,
    "u_size": 4,
    "rated_power_w": 1200,
    "weight_kg": 30,
    "network_ports": 2,
    "replica_group": "RG-01"
  },
  "racks": [],
  "slots": []
}
```

Python 返回：

```json
{
  "schema_version": 1,
  "engine": "cp_sat",
  "status": "optimal",
  "duration_ms": 123,
  "candidates": [
    {
      "objective_value": 1420,
      "placements": [
        {
          "device_index": 0,
          "rack_id": "CAB-03",
          "layer_id": "L02",
          "start_u": 14
        }
      ]
    }
  ]
}
```

允许的 Python 状态为：

- `optimal`：已证明当前模型目标最优。
- `feasible`：在时间限制内找到可行解但未证明最优。
- `infeasible`：已证明没有直接上架解。
- `unknown`：时间内没有得到可用结论。

`unknown` 按求解器不可用处理并进入 Beam Search 回退；`infeasible` 不视为技术故障，直接进入隔板和迁移流程。

## CP-SAT 模型

### 决策变量

对每台待上架设备 `i` 和每个合法槽位 `s` 创建布尔变量 `x[i,s]`：

```text
x[i,s] = 1 表示设备 i 放入槽位 s
```

每台设备必须且只能选择一个槽位。

批量设备规格相同时增加槽位索引非递减约束，消除仅交换设备编号而产生的重复方案。

### U 位约束

现有设备已经从槽位枚举中排除。对每个机柜、每个 U 位，所有覆盖该 U 位的新设备变量之和不得超过 1：

```text
sum(x[i,s] where s covers rack/U) <= 1
```

这保证批量新设备之间也不会重叠。

### 容量约束

对每个机柜分别限制：

```text
新增额定功率 <= 剩余设计功率
新增重量 <= 剩余承重
新增端口 <= 剩余端口
```

第一阶段继续使用额定功率判断。真实功率接入后只替换容量输入，不改变求解器边界。

### 副本故障域

请求包含 `replica_group` 时：

- 已有同组设备所在的电源源和交换机域禁止再次使用。
- 同一批新设备在同一电源源最多放置一台。
- 同一批新设备在同一交换机域最多放置一台。

该约束优先于业务邻近、机柜偏好和任何软评分。

### 策略目标

所有软成本使用整数，避免浮点模型差异。

- `balanced_optimal`：最小化容量压力、业务距离、链路距离、偏好偏离和碎片代理成本的加权和。
- `consolidated`：首先最小化新启用机柜数量，其次最小化机柜分散和碎片；投影利用率达到 80% 的槽位不进入该策略候选。
- `load_balanced`：首先最小化最高投影功率利用率，其次最小化电源源负载差和综合容量压力。

CP-SAT 目标只负责引导候选搜索。现有 `scoreCandidate()` 仍使用完整投影快照计算最终分数并决定展示顺序。

### 最多 4 个不同候选

求得一个方案后，加入排除该完整放置组合的 no-good 约束，再用剩余时间求下一个方案。满足以下任一条件即停止：

- 已获得 4 个不同候选。
- 模型没有更多可行解。
- 2 秒总预算耗尽。

不足 4 个时按实际可行数量返回，不使用重复方案或低质量虚构方案补齐。

## 最终安全复核

CP-SAT 不是最终安全边界。每个返回候选都必须转换为现有动作并执行 `evaluateActions()`。

复核继续覆盖：

- 机柜角色和 U 位边界。
- 连续空间、重叠和预留区。
- 10U 设备 L01 限制。
- 额定功率、重量和端口。
- 副本电源及网络故障域。
- 状态快照和计划确认时的版本一致性。

任何 CP-SAT 候选复核失败都会被丢弃并记录 `CP_SAT_VALIDATION_REJECTED`。如果全部候选被拒绝，则回退 Beam Search，而不是放宽规则。

## 异常与回退

以下情况属于技术故障：

- Python 解释器不存在：`CP_SAT_PYTHON_UNAVAILABLE`。
- OR-Tools 未安装或导入失败：`CP_SAT_DEPENDENCY_MISSING`。
- Python 超时：`CP_SAT_TIMEOUT`。
- 进程非零退出：`CP_SAT_PROCESS_FAILED`。
- 输出不是合法 JSON：`CP_SAT_OUTPUT_INVALID`。
- 输出超过大小限制：`CP_SAT_OUTPUT_TOO_LARGE`。
- 返回未知机柜、层、槽位或设备索引：`CP_SAT_CONTRACT_INVALID`。
- 所有候选未通过规则复核：`CP_SAT_VALIDATION_REJECTED`。

这些错误只改变候选来源，不中断上架流程。系统使用 Beam Search 继续规划，并在结果中记录回退原因。

当 `CP_SAT_ENABLED=false` 时，直接使用 Beam Search，状态为 `disabled`，不记录为故障。

## 结果元数据与审计

规划结果增加：

```json
{
  "solver": {
    "engine": "cp_sat",
    "status": "optimal",
    "duration_ms": 123,
    "candidate_count": 4,
    "fallback_reason": null
  }
}
```

回退时：

```json
{
  "solver": {
    "engine": "beam_search",
    "status": "fallback",
    "duration_ms": 2510,
    "candidate_count": 2,
    "fallback_reason": "CP_SAT_TIMEOUT"
  }
}
```

候选来源、求解状态、耗时、候选数量和安全错误码进入计划与审计信息。完整求解输入、Python 堆栈、环境变量和敏感配置不进入浏览器响应或审计日志。

## 安全边界

- Python 脚本路径来自应用固定路径，不接受浏览器输入。
- Python 解释器路径仅来自服务器环境配置。
- 进程调用不经过 shell。
- 输入和输出均有大小上限。
- `max_candidates` 在 Node.js 和 Python 两端都限制为 4。
- `time_limit_ms` 在 Python 端限制为不超过 2000。
- Python 输出只允许引用输入中出现的机柜、层和槽位。
- CP-SAT 不能修改设备测量事实、机柜设计容量、规则结果或状态版本。
- CP-SAT 不能直接执行动作，只能生成等待选择的候选。

## 测试设计

### Node.js 单元测试

- 精确枚举空闲区间中的全部合法起始 U 位。
- 10U 设备只生成 L01 槽位。
- 适配器正确转换 1–4 个 Python 候选。
- 第 5 个及后续候选被拒绝。
- 未知机柜、层、槽位和设备索引被拒绝。
- 缺少 Python、缺少依赖、超时、非零退出和非法 JSON 均稳定回退。
- CP-SAT 候选必须再次通过 `evaluateActions()`。
- `infeasible` 进入隔板和迁移流程而不是 Beam 技术回退。
- `CP_SAT_ENABLED=false` 保持现有行为。

### Python 单元测试

- 单台服务器选择合法连续 U 位。
- 批量服务器不会重叠。
- 功率、重量和端口约束分别阻止超限方案。
- 副本设备分散到不同电源和交换机故障域。
- 相同输入多次运行返回相同顺序。
- 候选数量永远不超过 4。
- 无解返回 `infeasible`。

### 集成与回归测试

- 安装 `ortools==9.15.6755` 后，Node.js 通过真实 Python 进程完成一次规划。
- 三种策略得到合法且可解释的候选排序。
- CP-SAT 关闭或损坏时，现有 Beam、隔板和迁移测试继续通过。
- 所有现有 Node.js 单元、API 和浏览器闭环测试继续通过。

## 验收标准

1. 有多个合法起始位置时，CP-SAT 能搜索空闲区间内的全部位置，而不局限于区间起点。
2. 单台和批量上架都能返回 1–4 个不同候选。
3. 候选不违反 U 位、功率、重量、端口、10U 和副本故障域约束。
4. 三种策略继续使用原有可解释评分，并能产生不同排序。
5. 相同输入在固定版本和固定配置下得到相同候选顺序。
6. Python 或 OR-Tools 不可用时，网页仍能使用 Beam Search 完成规划。
7. CP-SAT 没有直接解时，隔板和迁移流程仍可运行。
8. 规划结果和审计能区分 `cp_sat`、`beam_search` 与回退原因。
9. 任何候选只有经过现有风险校验并由管理者一次最终确认后才能执行。
10. 远程访问用户不需要安装 Python；生产服务器容器包含 Node.js、Python 和 OR-Tools。

## 后续演进

第一阶段稳定后，可在不改变 Node.js 领域模型和 JSON 契约的前提下：

- 把 CLI 适配器替换为常驻 Python HTTP 服务。
- 把隔板调整纳入 CP-SAT。
- 把合规迁移动作纳入统一求解模型。
- 接入真实功率后增加额定功率与实时功率的双重容量约束。
- 结合弱电拓扑，把 NetworkX 计算的布线路径成本作为 CP-SAT 软成本输入。
