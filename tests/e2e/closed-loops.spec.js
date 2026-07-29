import { test, expect } from "playwright/test";

async function login(page, username = "admin", password = "demo-admin-pass") {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  const [loginResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/login")),
    page.getByRole("button", { name: "登录控制台" }).click(),
  ]);
  expect(loginResponse.status()).toBe(200);
  await expect.poll(async () => {
    const response = await page.request.get("/api/auth/session");
    return response.json();
  }).toMatchObject({ authenticated: true, actor: username });
  await expect(page.locator("#login-panel")).toHaveClass(/is-hidden/);
  await expect(page.locator(".rack-card")).toHaveCount(22);
}

async function resetDemo(page) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/demo/reset", { headers: { origin }, data: {} });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "机房总览" })).toBeVisible();
}

test("overview drills into a 42U rack and full server detail", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await expect(page.locator(".rack-card")).toHaveCount(22);
  await page.screenshot({ path: "output/playwright/overview.png", fullPage: true });
  await page.getByRole("button", { name: "查看 CAB-09 机柜详情" }).click();
  await expect(page.getByRole("heading", { name: /CAB-09 · 服务器机柜 09/ })).toBeVisible();
  await expect(page.locator(".rack-layer")).toHaveCount(4);
  await expect(page.locator(".u-reserve")).toHaveCount(4);
  await expect(page.locator(".u-reserve").first()).toContainText(/预留 U\d+–U\d+ \/ 本层一次/);
  await page.getByRole("button", { name: "查看服务器 gpu-demo-01" }).click();
  await expect(page.getByText("CAB-09-PDU / P01")).toBeVisible();
  await expect(page.getByText("ASW-05 / GE0/0/01")).toBeVisible();
});

test("placement closes through one final confirmation and inventory verification", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.getByRole("button", { name: /上架 Agent/ }).click();
  await page.getByLabel("本次部署策略").selectOption("load_balanced");
  await page.getByLabel("设备编号").fill("SRV-E2E-PLACEMENT");
  await page.getByLabel("优选机柜").selectOption("CAB-03");
  await page.getByRole("button", { name: "生成上架方案" }).click();
  await expect(page.getByRole("heading", { name: /负载均衡方案已完成硬约束复核/ })).toBeVisible();
  await expect(page.getByLabel("本次部署策略")).toHaveValue("load_balanced");
  await expect(page.locator(".decision-comparison")).toContainText("规则基线");
  await expect(page.locator(".agent-intervention")).toContainText("Agent 状态");
  await expect(page.locator(".candidate-card").first()).toContainText(/U\d+–U\d+/);
  await page.screenshot({ path: "output/playwright/placement-strategy.png", fullPage: true });
  await page.getByRole("button", { name: "进入最终确认" }).click();
  await expect(page.getByRole("dialog")).toContainText("这是唯一一次确认");
  await expect(page.getByRole("dialog")).toContainText("快照 v");
  await page.getByRole("button", { name: "确认并模拟执行" }).click();
  await expect(page.getByText("执行并验证成功")).toBeVisible();
  await page.getByRole("button", { name: /机房总览/ }).click();
  await page.getByRole("button", { name: "查看 CAB-03 机柜详情" }).click();
  await expect(page.getByRole("button", { name: "查看服务器 SRV-E2E-PLACEMENT" })).toBeVisible();
});

test("a 10U server can be planned directly into the reserved CAB-01 L01 bay", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.getByRole("button", { name: /上架 Agent/ }).click();
  await page.getByLabel("设备编号").fill("SRV-E2E-10U");
  await page.getByLabel("设备高度（U）").fill("10");
  await page.getByLabel("优选机柜").selectOption("CAB-01");
  await page.getByRole("button", { name: "生成上架方案" }).click();

  await expect(page.locator(".candidate-card").first()).toContainText("CAB-01 / L01");
  await expect(page.locator(".candidate-card").first()).toContainText("U1–U10");
  await expect(page.getByRole("button", { name: "进入最终确认" })).toBeVisible();
});

test("eligible server removal closes through confirmation, verification, and audit", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.getByRole("button", { name: "查看 CAB-03 机柜详情" }).click();
  const removable = page.locator(".device-block[data-removable]").first();
  const deviceId = await removable.getAttribute("data-device-id");
  await removable.click();
  await page.getByRole("button", { name: "生成取出方案" }).click();
  await expect(page.getByRole("heading", { name: /取出方案已完成风险复核/ })).toBeVisible();
  await page.getByRole("button", { name: "进入最终确认" }).click();
  await expect(page.getByRole("dialog")).toContainText("这是唯一一次确认");
  await page.getByRole("button", { name: "确认并模拟执行" }).click();
  await expect(page.getByText("取出并验证成功")).toBeVisible();

  const response = await page.request.get(`/api/devices/${deviceId}`);
  expect(response.status()).toBe(404);
  await page.getByRole("button", { name: /变更审计/ }).click();
  const entry = page.locator(".audit-entry").filter({ hasText: deviceId }).first();
  await entry.locator("summary").click();
  await expect(entry.locator(".audit-entry-details")).toContainText(deviceId);
});

test("power alarm closes through diagnosis, remediation, confirmation, and audit", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.locator('[data-view="alarms"]').click();
  await page.getByRole("button", { name: /模拟功率过高/ }).click();
  await page.getByRole("button", { name: "Agent 诊断" }).click();
  await expect(page.getByText("机柜额定功率达到设计容量预警线")).toBeVisible();
  await page.getByRole("button", { name: "生成处置方案" }).click();
  await page.getByRole("button", { name: "进入最终确认" }).click();
  await page.getByRole("button", { name: "确认并模拟执行" }).click();
  await expect(page.locator(".recovery-card")).toContainText("已恢复");
  await expect(page.locator(".recovery-card")).toContainText("恢复验证通过");
  await page.screenshot({ path: "output/playwright/alarm-recovered.png", fullPage: true });
  await page.locator('[data-view="audit"]').click();
  await expect(page.locator(".audit-timeline")).toContainText("恢复验证通过");
});

for (const [scenario, rootCause] of [
  ["模拟层位冲突", "待上架设备与现有层位或预留空间冲突"],
  ["模拟采集离线", "数据采集服务离线，实时值不可用"],
  ["模拟模型离线", "私有模型服务不可用，系统已降级到规则引擎"],
  ["模拟执行故障", "模拟执行失败且已回滚到执行前状态"],
]) {
  test(`${scenario} closes through verified remediation`, async ({ page }) => {
    await login(page);
    await resetDemo(page);
    await page.locator('[data-view="alarms"]').click();
    await page.getByRole("button", { name: new RegExp(scenario) }).click();
    if (scenario === "模拟采集离线") {
      await page.locator('[data-view="topology"]').click();
      await expect(page.getByText("采集离线 · 使用设计数据")).toBeVisible();
      await page.locator('[data-view="alarms"]').click();
    }
    if (scenario === "模拟模型离线") {
      await page.locator('[data-view="agent"]').click();
      await expect(page.getByText(/模型服务离线：自然语言入口已降级/)).toBeVisible();
      await page.locator('[data-view="alarms"]').click();
    }
    await page.getByRole("button", { name: "Agent 诊断" }).click();
    await expect(page.getByText(rootCause)).toBeVisible();
    await page.getByRole("button", { name: "生成处置方案" }).click();
    await page.getByRole("button", { name: "进入最终确认" }).click();
    await page.getByRole("button", { name: "确认并模拟执行" }).click();
    await expect(page.locator(".recovery-card")).toContainText("恢复验证通过");
  });
}

test("simulated placement failure rolls back inventory and writes a failure audit", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.locator('[data-view="agent"]').click();
  await page.getByLabel("设备编号").fill("SRV-E2E-ROLLBACK");
  await page.getByLabel("执行演示").selectOption({ label: "模拟执行中失败并回滚" });
  await page.getByRole("button", { name: "生成上架方案" }).click();
  await page.getByRole("button", { name: "进入最终确认" }).click();
  await page.getByRole("button", { name: "确认并模拟执行" }).click();
  await expect(page.getByText("执行失败，回滚完成")).toBeVisible();
  const missing = await page.request.get("/api/devices/SRV-E2E-ROLLBACK");
  expect(missing.status()).toBe(404);
  await page.locator('[data-view="audit"]').click();
  await expect(page.locator(".audit-timeline")).toContainText("方案执行失败并回滚");
});

test("viewer can inspect but cannot run mutating scenarios", async ({ page }) => {
  await login(page, "viewer", "demo-viewer-pass");
  await expect(page.locator(".rack-card")).toHaveCount(22);
  await page.getByRole("button", { name: /上架 Agent/ }).click();
  await expect(page.getByRole("button", { name: "生成上架方案" })).toBeDisabled();
  await page.locator('[data-view="alarms"]').click();
  await expect(page.getByRole("button", { name: /模拟功率过高/ })).toBeDisabled();
});

test("topology query preserves evidence and administrative reset returns to seed", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.getByRole("button", { name: /链路查询/ }).click();
  await expect(page.getByText("CAB-09-PDU / P01")).toBeVisible();
  await expect(page.getByText("GE0/0/01", { exact: false })).toBeVisible();
  await expect(page.getByText(/不作冗余承诺/)).toBeVisible();
  await page.getByRole("button", { name: /变更审计/ }).click();
  await page.getByRole("button", { name: "重置演示数据" }).click();
  await page.getByRole("button", { name: "确认重置演示数据" }).click();
  await expect(page.getByRole("heading", { name: "机房总览" })).toBeVisible();
  await expect(page.locator(".rack-card")).toHaveCount(22);
});

test("audit details stay on the audit page and topology objects form an interactive query loop", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.getByRole("button", { name: /变更审计/ }).click();
  const auditEntry = page.locator(".audit-entry").first();
  await auditEntry.locator("summary").click();
  await expect(auditEntry.locator(".audit-entry-details")).toBeVisible();
  await expect(page.getByRole("heading", { name: "变更与诊断审计" })).toBeVisible();

  await page.getByRole("button", { name: /链路查询/ }).click();
  await page.getByRole("button", { name: "查询 CAB-09" }).click();
  await expect(page.locator(".topology-selection")).toContainText("CAB-09");
  await page.getByRole("button", { name: "查看 ASW-05 链路" }).click();
  await expect(page.locator(".topology-selection")).toContainText("ASW-05");
  await expect(page.getByRole("button", { name: "查看 CAB-09 链路" })).toBeVisible();
});

test("overview colors racks by the higher capacity risk and exposes weak-current routes", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  const warningRack = page.locator('.rack-card[data-risk-basis="U 位"]').filter({ hasText: "CAB-18" });
  await expect(warningRack).toHaveClass(/rack-warning/);
  await expect(warningRack).toContainText("U 位 88%");
  await expect(page.locator(".network-route-map")).toContainText("CORE-01");
  await expect(page.locator(".network-route-map")).toContainText("ASW-05");
  await page.getByRole("button", { name: "查看 ASW-05 弱电链路" }).click();
  await expect(page.locator(".topology-selection")).toContainText("ASW-05");
});
