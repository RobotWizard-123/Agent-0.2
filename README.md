# L5-A2-08 机房智能管理 Agent V0.2

这是面向领导演示的远程网站版本：用确定性规则完成设备上架、容量判断、链路查询、变更确认、报警诊断、恢复验证和审计。当前数据仓库为版本化 JSON，领域规则、采集、执行和 Agent 均已隔离，后续可以用 NetBox 与真实采集器替换适配层。

## 已实现的演示闭环

- 22 个机柜平面与 JG1/JG2/KT1 功率母线，其中 20 个服务器柜、2 个网络柜。
- 42U 四层真实占用视图，固定设备保留原始 U 位与物理空洞，每层只预留一次 2U；机柜内可查看具体服务器、PDU 和交换机端口。
- 10/20kW 设计容量、U 位、重量和端口的硬约束；10U 设备强制放在 L01。
- 上架 Agent 支持“综合最优、集中部署、负载均衡”三种策略；候选方案显示精确 U 位、四类容量水位、评分分解和迁移影响。
- 真实 Agent 可在限定权重与已知实体范围内干预候选排序，越界建议会被拒绝并保留审计证据；模型离线时自动回退到规则引擎。
- 全站悬浮 AI 助手读取当前页面、机柜、设备、告警与方案上下文，每 30 秒同步一次状态反馈，但不能绕过最终确认。
- 状态变更只有一次最终确认，执行成功后验证，失败时回滚并报警。
- 功率过高、层位冲突、采集离线、模型离线、执行故障五类演示报警。
- 设备、机柜、电源和交换机链路查询；未知链路不会被虚构，也不宣称未经核实的 A/B 冗余。
- 管理员和只读查看者两种角色，写请求校验同源，Cookie 使用 HttpOnly 与 SameSite=Strict。

## 本地启动

要求 Node.js 22 或更高版本。

```powershell
npm install
Copy-Item .env.example .env
npm run reset:demo
npm start
```

在本地 `.env` 中填写三个登录配置：`SESSION_SECRET`、`APP_ADMIN_PASSWORD`、`APP_VIEWER_PASSWORD`。`.env` 已被 Git 忽略，不要提交真实密码或模型密钥。默认访问地址为 `http://127.0.0.1:3000`。

私有模型为可选项，仅从 `AGENT_BASE_URL`、`AGENT_API_KEY`、`AGENT_MODEL` 和 `AGENT_TIMEOUT_MS` 读取。没有配置或模型离线时，系统会切换到结构化表单与确定性规则引擎。

## 测试

```powershell
npm test
npm run test:e2e
npm run test:all
```

Windows 默认使用已安装的 Microsoft Edge。Linux 首次运行前执行 `npx playwright install chromium`。浏览器截图与失败跟踪写入 `output/playwright/`，不会进入 Git。

## 领导演示顺序

1. 登录管理员账号，在“机房总览”说明 22 柜、设计容量来源和实时采集预留。
2. 点击 CAB-09，展示 42U 四层、每层一次 2U 预留和 GPU 服务器的强弱电明细。
3. 在“上架 Agent”依次选择三种策略，填写 4U 设备并指定优选机柜；比较规则基线与 Agent 评分、精确 U 位、容量变化和干预理由。
4. 进入唯一一次最终确认，展示快照版本、动作清单和回滚边界，然后执行并返回机柜核对设备已经落在指定 U 位。
5. 在“链路查询”检索 `SRV-DEMO-10U`，分别讲解电源和网络证据以及“冗余未核实”。
6. 在“报警诊断”触发“模拟功率过高”，依次执行 Agent 诊断、生成处置方案、最终确认和恢复验证。
7. 在“变更审计”展示策略、Agent 干预、执行和报警恢复记录，最后重置演示数据。

## Docker 运行

先在当前终端设置所需环境变量，再启动应用：

```powershell
docker compose build app
docker compose up -d app
docker compose ps
```

默认只绑定 `127.0.0.1:3000`。需要局域网临时访问时，将 `APP_BIND_ADDRESS` 设为服务器内网地址，并通过防火墙限制来源。正式远程访问应启用 HTTPS 反向代理。

HTTPS 模式需要把证书以 `deploy/certs/fullchain.pem` 和 `deploy/certs/privkey.pem` 挂载，然后设置 `TRUST_PROXY_HTTPS=true`：

```powershell
docker compose --profile https up -d
```

Nginx 会将 HTTP 重定向到 HTTPS、添加安全响应头，并把原始 Host 与协议传给应用。生产环境应使用受信任证书、强随机会话密钥，并在反向代理或防火墙限制管理入口。

## 数据重置、备份与恢复

- 浏览器“变更审计”页的管理员重置会恢复标准种子并写入一条重置审计。
- 命令行可执行 `npm run reset:demo`。
- 容器运行数据位于 `datacenter-runtime` 卷；升级前备份 `/app/data/runtime/state.json`。
- 恢复时停止应用、还原该文件，再启动容器并访问 `/health/ready`。

## 接入真实系统前

1. 轮换任何曾在聊天、截图或日志中出现过的模型 API Key。
2. 接入 NetBox 仓库适配器，将机柜、设备、接口、电源口和线缆映射到当前领域模型。
3. 接入功率、温度和端口采集器；缺失值必须保持 `unknown`，不能当作零。
4. 将模拟执行适配器替换为工单/自动化平台，并保留计划锁定、一次确认、执行后验证和回滚语义。
5. 完成设备级 A/B 路径核实后，才允许在界面标记冗余。

健康检查：`/health/live` 表示进程存活；`/health/ready` 表示核心仓库可读，并单独报告模型与采集器的降级状态。模型或采集器离线不会让规则引擎失去可用性。
