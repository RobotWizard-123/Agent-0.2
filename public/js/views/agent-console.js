import {
  formatPower,
  h,
  panel,
  showToast,
  sourceBadge,
  statusBadge,
} from "../components.js";
import { createPlan, updatePlacementDefault } from "../state.js";
import { renderPlacementPlan } from "./placement-plan.js";

const strategies = [
  { id: "balanced_optimal", name: "综合最优", detail: "兼顾业务邻近、空间连续性与容量水位" },
  { id: "consolidated", name: "集中部署", detail: "优先复用已启用机柜，减少新柜启用" },
  { id: "load_balanced", name: "负载均衡", detail: "优先平衡机柜容量与上游电源负载" },
];

function strategySelect(state, label = "部署策略") {
  const selected = state.currentPlan?.strategy_id ?? state.placementSettings?.default_strategy_id ?? "balanced_optimal";
  return h("select", { name: "strategy_id", "aria-label": label }, strategies.map((strategy) => h("option", {
    value: strategy.id,
    text: `${strategy.name} · ${strategy.detail}`,
    selected: strategy.id === selected,
  })));
}

function strategyControls(state, select) {
  const isAdmin = state.session.role === "admin";
  const saveButton = h("button", {
    type: "button",
    className: "secondary-button",
    text: "设为系统默认",
    disabled: !isAdmin,
  });
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      await updatePlacementDefault(select.value);
      showToast("默认部署策略已更新");
    } catch (error) {
      showToast(`${error.code ?? "SETTING_FAILED"} · ${error.message}`, "danger");
    } finally {
      saveButton.disabled = !isAdmin;
    }
  });
  return h("div", { className: "strategy-controls" }, [
    h("label", { className: "form-field strategy-option" }, ["本次部署策略", select]),
    h("div", { className: "strategy-default" }, [
      h("span", { text: `系统默认：${strategies.find((item) => item.id === (state.placementSettings?.default_strategy_id ?? "balanced_optimal"))?.name}` }),
      saveButton,
    ]),
    !isAdmin ? h("p", { className: "readonly-note", text: "只读账号可查看策略，不能修改默认值或生成方案。" }) : null,
  ]);
}

function nextDeviceId(currentId) {
  const match = typeof currentId === "string" && currentId.match(/^(.*)-(\d+)$/);
  if (match) {
    const prefix = match[1];
    const num = parseInt(match[2], 10) + 1;
    const pad = Math.max(2, match[2].length);
    return `${prefix}-${String(num).padStart(pad, "0")}`;
  }
  return `${currentId}-01`;
}

function uniqueDeviceId(currentId, devices) {
  const existing = new Set((devices ?? []).map((device) => device.id));
  let id = currentId;
  let guard = 0;
  while (existing.has(id) && guard < 1000) {
    id = nextDeviceId(id);
    guard += 1;
  }
  return id;
}

function structuredForm(state) {
  const select = strategySelect(state, "本次部署策略");
  const form = h("form", { className: "agent-form" }, [
    strategyControls(state, select),
    h("div", { className: "form-grid" }, [
      h("label", { className: "form-field" }, ["设备编号", h("input", { name: "id", value: "SRV-LEADER-DEMO", required: true })]),
      h("label", { className: "form-field" }, ["IT-Code", h("input", { name: "it_code", value: "", placeholder: "选填" })]),
      h("label", { className: "form-field" }, ["数量", h("input", { name: "count", type: "number", min: 1, value: 1, required: true })]),
      h("label", { className: "form-field" }, ["设备高度（U）", h("input", { name: "u_size", type: "number", min: 1, max: 10, value: 4, required: true })]),
      h("label", { className: "form-field" }, ["额定功率（W）", h("input", { name: "rated_power_w", type: "number", min: 1, value: 1800, required: true })]),
      h("label", { className: "form-field" }, ["重量（kg）", h("input", { name: "weight_kg", type: "number", min: 0, value: 42, required: true })]),
      h("label", { className: "form-field" }, ["网络端口", h("input", { name: "network_ports", type: "number", min: 0, value: 2, required: true })]),
      h("label", { className: "form-field" }, ["优选机柜", h("select", { name: "preferred_rack" }, [
        h("option", { value: "", text: "自动选择" }),
        ...state.racks.filter((rack) => rack.role === "server").map((rack) => h("option", { value: rack.id, text: `${rack.id} · ${formatPower(rack.design_power_w)}` })),
      ])]),
      h("label", { className: "form-field" }, ["执行演示", h("select", { name: "fail_at" }, [
        h("option", { value: "", text: "正常执行" }),
        h("option", { value: "written", text: "模拟执行中失败并回滚" }),
      ])]),
    ]),
    h("button", { type: "submit", className: "primary-button", text: "生成上架方案", disabled: state.session.role !== "admin" }),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const preferred = data.get("preferred_rack");
    const submit = form.querySelector("button[type=submit]");
    const idInput = form.querySelector('input[name="id"]');
    submit.disabled = true;
    submit.textContent = "正在计算…";
    try {
      const deviceId = uniqueDeviceId(data.get("id"), state.devices);
      const itCode = data.get("it_code")?.trim();
      await createPlan({
        kind: "placement",
        strategy_id: data.get("strategy_id"),
        fail_at: data.get("fail_at") || null,
        device: {
          id: deviceId,
          it_code: itCode || null,
          count: Number(data.get("count")),
          u_size: Number(data.get("u_size")),
          rated_power_w: Number(data.get("rated_power_w")),
          real_power_w: null,
          weight_kg: Number(data.get("weight_kg")),
          network_ports: Number(data.get("network_ports")),
          preferred_rack_ids: preferred ? [preferred] : [],
        },
      });
      idInput.value = nextDeviceId(deviceId);
      showToast("方案已生成，等待最终确认");
    } catch (error) {
      showToast(`${error.code ?? "PLAN_FAILED"} · ${error.message}`, "danger");
    } finally {
      submit.disabled = state.session.role !== "admin";
      submit.textContent = "生成上架方案";
    }
  });
  return form;
}

function naturalLanguageForm(state) {
  const select = strategySelect(state, "Agent 解析策略");
  const form = h("form", { className: "natural-form" }, [
    h("div", { className: "strategy-controls compact" }, [h("label", { className: "form-field strategy-option" }, ["Agent 解析策略", select])]),
    h("label", { className: "form-field" }, ["用自然语言描述任务", h("textarea", { name: "text", rows: 3, required: true, placeholder: "例如：将一台 10U、3500W、120kg、4 网口的 GPU 服务器上架，优先 CAB-10。" })]),
    h("button", { type: "submit", className: "secondary-button", text: "让 Agent 解析", disabled: state.session.role !== "admin" }),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const data = new FormData(form);
    button.disabled = true;
    button.textContent = "正在解析…";
    try {
      await createPlan({ kind: "natural_language", text: data.get("text"), strategy_id: data.get("strategy_id") });
      showToast("Agent 已完成解析和硬约束复核");
    } catch (error) {
      showToast(`${error.code ?? "AGENT_FAILED"} · ${error.message}`, "danger");
    } finally {
      button.disabled = state.session.role !== "admin";
      button.textContent = "让 Agent 解析";
    }
  });
  return form;
}

export function renderAgentConsole(container, state) {
  const modelOffline = state.alarms.some((alarm) => alarm.status !== "resolved" && alarm.scenario === "model_offline");
  const intro = h("section", { className: "view-intro" }, [
    h("div", {}, [
      h("p", { className: "section-kicker", text: "方案 → 校验 → Agent 复核 → 确认 → 执行 → 验证" }),
      h("h2", { text: "约束优先的上架 Agent" }),
      h("p", { text: "管理者可自由选择三种部署策略；Agent 可重排安全候选，但不能改写设备功率、尺寸、真实 U 位或机柜设计容量。" }),
    ]),
    h("div", { className: "intro-badges" }, [
      sourceBadge("rule"),
      statusBadge(modelOffline || !state.config?.agent_configured ? "规则引擎接管" : "模型可用", modelOffline || !state.config?.agent_configured ? "warning" : "ok"),
    ]),
  ]);
  const input = panel("描述上架需求", h("div", { className: "agent-input-stack" }, [
    modelOffline ? h("div", { className: "degraded-banner", text: "模型服务离线：自然语言入口已降级，结构化表单和全部硬约束仍然可用。" }) : naturalLanguageForm(state),
    h("div", { className: "or-divider", text: "结构化参数 / 可审计" }),
    structuredForm(state),
  ]), { kicker: "请求" });
  const result = panel("候选方案与风险", renderPlacementPlan(state.currentPlan, state), { kicker: "规则 + Agent 复核" });
  container.replaceChildren(intro, h("section", { className: "agent-grid" }, [input, result]));
}
