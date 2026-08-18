import {
  formatPower,
  h,
  panel,
  showToast,
  sourceBadge,
  statusBadge,
} from "../components.js";
import { createPlan } from "../state.js";
import { renderPlacementPlan } from "./placement-plan.js";

const STRATEGY_ID = "balanced_optimal";
const MANUAL_ERROR_MESSAGES = Object.freeze({
  MANUAL_TARGET_REQUIRED: "请选择目标机柜、挡板层和起始 U 位",
  MANUAL_PLACEMENT_COUNT_INVALID: "手动精确位置仅支持单台服务器",
  TARGET_RACK_NOT_FOUND: "目标机柜不存在",
  TARGET_RACK_NOT_DEPLOYABLE: "目标机柜不是服务器机柜",
  TARGET_LAYER_NOT_FOUND: "目标挡板层不存在或不属于所选机柜",
  TARGET_START_U_INVALID: "起始 U 位必须是正整数",
  TARGET_POSITION_OUT_OF_RANGE: "服务器将超出挡板层的可用 U 位范围",
  TARGET_POSITION_OCCUPIED: "目标 U 位已被占用",
});

function placementErrorMessage(error, fallback) {
  const code = error.code ?? "PLAN_FAILED";
  return `${code} · ${MANUAL_ERROR_MESSAGES[code] ?? error.message ?? fallback}`;
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
  const modeSelect = h("select", { name: "placement_mode", "aria-label": "部署方式" }, [
    h("option", { value: "automatic", text: "自动规划位置" }),
    h("option", { value: "manual", text: "手动指定机柜、挡板层和 U 位" }),
  ]);
  const countInput = h("input", { name: "count", type: "number", min: 1, value: 1, required: true });
  const preferredRack = h("select", { name: "preferred_rack" }, [
    h("option", { value: "", text: "自动选择" }),
    ...state.racks.filter((rack) => rack.role === "server")
      .map((rack) => h("option", { value: rack.id, text: `${rack.id} · ${formatPower(rack.design_power_w)}` })),
  ]);
  const preferredRackField = h("label", { className: "form-field" }, ["优选机柜", preferredRack]);
  const targetRack = h("select", { name: "target_rack_id" }, [
    h("option", { value: "", text: "请选择机柜" }),
    ...state.racks.filter((rack) => rack.role === "server")
      .map((rack) => h("option", { value: rack.id, text: `${rack.id} · ${formatPower(rack.design_power_w)}` })),
  ]);
  const targetLayer = h("select", { name: "target_layer_id" }, [
    h("option", { value: "", text: "请先选择机柜" }),
  ]);
  const targetStartU = h("input", {
    name: "target_start_u",
    type: "number",
    min: 1,
    step: 1,
    placeholder: "请输入起始 U 位",
  });
  const manualFields = h("div", { className: "form-grid", hidden: true }, [
    h("label", { className: "form-field" }, ["目标机柜", targetRack]),
    h("label", { className: "form-field" }, ["目标挡板层", targetLayer]),
    h("label", { className: "form-field" }, ["起始 U 位", targetStartU]),
  ]);

  const form = h("form", { className: "agent-form" }, [
    h("div", { className: "form-grid" }, [
      h("label", { className: "form-field" }, ["部署方式", modeSelect]),
      h("label", { className: "form-field" }, ["设备编号", h("input", { name: "id", value: "SRV-LEADER-DEMO", required: true })]),
      h("label", { className: "form-field" }, ["IT-Code", h("input", { name: "it_code", value: "", placeholder: "选填" })]),
      h("label", { className: "form-field" }, ["数量", countInput]),
      h("label", { className: "form-field" }, ["设备高度（U）", h("input", { name: "u_size", type: "number", min: 1, max: 10, value: 4, required: true })]),
      h("label", { className: "form-field" }, ["额定功率（W）", h("input", { name: "rated_power_w", type: "number", min: 1, value: 1800, required: true })]),
      h("label", { className: "form-field" }, ["重量（kg）", h("input", { name: "weight_kg", type: "number", min: 0, value: 42, required: true })]),
      h("label", { className: "form-field" }, ["网络端口", h("input", { name: "network_ports", type: "number", min: 0, value: 2, required: true })]),
      preferredRackField,
      h("label", { className: "form-field" }, ["执行演示", h("select", { name: "fail_at" }, [
        h("option", { value: "", text: "正常执行" }),
        h("option", { value: "written", text: "模拟执行中失败并回滚" }),
      ])]),
    ]),
    manualFields,
    h("button", { type: "submit", className: "primary-button", text: "生成上架方案", disabled: state.session.role !== "admin" }),
  ]);

  function resetLayerOptions() {
    targetLayer.replaceChildren(h("option", { value: "", text: targetRack.value ? "请选择挡板层" : "请先选择机柜" }));
    targetStartU.value = "";
    targetStartU.removeAttribute("max");
  }

  targetRack.addEventListener("change", () => {
    resetLayerOptions();
    const rack = state.racks.find((item) => item.id === targetRack.value);
    for (const layer of rack?.capacity?.layers ?? []) {
      targetLayer.append(h("option", {
        value: layer.id,
        text: `${layer.id} · U${layer.start_u}–U${layer.usable_end_u}`,
      }));
    }
  });

  targetLayer.addEventListener("change", () => {
    const rack = state.racks.find((item) => item.id === targetRack.value);
    const layer = rack?.capacity?.layers?.find((item) => item.id === targetLayer.value);
    targetStartU.value = "";
    if (layer) {
      targetStartU.min = String(layer.start_u);
      targetStartU.max = String(layer.usable_end_u);
    } else {
      targetStartU.removeAttribute("max");
    }
  });

  function syncPlacementMode() {
    const manualMode = modeSelect.value === "manual";
    manualFields.hidden = !manualMode;
    preferredRackField.hidden = manualMode;
    countInput.readOnly = manualMode;
    if (manualMode) countInput.value = "1";
    for (const control of [targetRack, targetLayer, targetStartU]) control.required = manualMode;
  }
  modeSelect.addEventListener("change", syncPlacementMode);
  syncPlacementMode();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const preferred = data.get("preferred_rack");
    const manualMode = data.get("placement_mode") === "manual";
    const submit = form.querySelector("button[type=submit]");
    const idInput = form.querySelector('input[name="id"]');
    submit.disabled = true;
    submit.textContent = "正在计算…";
    try {
      const deviceId = uniqueDeviceId(data.get("id"), state.devices);
      const itCode = data.get("it_code")?.trim();
      await createPlan({
        kind: "placement",
        placement_mode: manualMode ? "manual" : "automatic",
        strategy_id: STRATEGY_ID,
        target_position: manualMode ? {
          rack_id: data.get("target_rack_id"),
          layer_id: data.get("target_layer_id"),
          start_u: Number(data.get("target_start_u")),
        } : null,
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
          preferred_rack_ids: !manualMode && preferred ? [preferred] : [],
        },
      });
      idInput.value = nextDeviceId(deviceId);
      showToast("方案已生成，等待最终确认");
    } catch (error) {
      showToast(placementErrorMessage(error, "方案生成失败"), "danger");
    } finally {
      submit.disabled = state.session.role !== "admin";
      submit.textContent = "生成上架方案";
    }
  });
  return form;
}

function naturalLanguageForm(state) {
  const form = h("form", { className: "natural-form" }, [
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
      await createPlan({
        kind: "natural_language",
        text: data.get("text"),
        placement_mode: "automatic",
        strategy_id: STRATEGY_ID,
      });
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
      h("p", { text: "自动模式采用综合最优规划；手动模式可锁定机柜、挡板层和起始 U 位，所有请求仍须通过硬约束复核。" }),
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
