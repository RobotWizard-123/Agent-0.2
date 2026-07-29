import {
  emptyState,
  formatPower,
  h,
  metricCard,
  panel,
  progressBar,
  sourceBadge,
  statusBadge,
} from "../components.js";
import { setRoute } from "../state.js";
import { rackRisk } from "../rack-risk.js";

function sum(items, field) {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function rackCard(rack, alarms) {
  const risk = rackRisk(rack, alarms);
  const usedU = rack.capacity.used_u;
  const usableU = rack.capacity.usable_u;
  return h("button", {
    type: "button",
    className: `rack-card rack-${risk.tone}`,
    "data-rack-id": rack.id,
    "data-risk-basis": risk.basis,
    "data-power-ratio": risk.power_ratio.toFixed(3),
    "data-capacity-ratio": risk.u_ratio.toFixed(3),
    "aria-label": `查看 ${rack.id} 机柜详情`,
    onClick: () => setRoute("rack", rack.id),
  }, [
    h("span", { className: "rack-card-top" }, [
      h("strong", { text: rack.id }),
      h("i", { className: "status-dot", "aria-hidden": "true" }),
    ]),
    h("span", { className: "rack-role", text: rack.role === "network" ? rack.alias ?? "网络柜" : rack.source_id }),
    h("span", { className: "rack-power", text: `${formatPower(rack.capacity.rated_power_used_w)} / ${formatPower(rack.capacity.design_power_w)}` }),
    h("span", { className: "rack-u", text: `${usedU} / ${usableU}U` }),
    h("span", { className: "rack-risk", text: `${risk.basis} ${Math.round(risk.ratio * 100)}%` }),
  ]);
}

function sourceGroup(sourceId, racks, alarms) {
  const items = racks.filter((rack) => rack.source_id === sourceId);
  const design = sum(items.map((rack) => rack.capacity), "design_power_w");
  const used = sum(items.map((rack) => rack.capacity), "rated_power_used_w");
  return h("section", { className: `source-group source-${sourceId.toLowerCase()}` }, [
    h("div", { className: "bus-rail" }, [
      h("span", { className: "bus-label", text: sourceId }),
      h("span", { className: "bus-line" }),
      h("span", { className: "bus-value", text: `${formatPower(used)} / ${formatPower(design)}` }),
    ]),
    h("div", { className: "rack-row" }, items.map((rack) => rackCard(rack, alarms))),
  ]);
}

function networkRouteMap(network, racks) {
  if (!network?.core || !network?.access_switches) {
    return emptyState("弱电路由数据未接入", "已保留核心、接入交换机与机柜的展示接口。");
  }
  const rackById = new Map(racks.map((rack) => [rack.id, rack]));
  return h("div", { className: "network-route-map" }, [
    h("button", {
      type: "button",
      className: "network-core-node",
      "aria-label": `查看 ${network.core.id} 弱电链路`,
      onClick: () => setRoute("topology", network.core.id),
    }, [
      h("span", { text: "CORE" }),
      h("strong", { text: network.core.id }),
      h("small", { text: network.external_uplink?.label ?? "上联未接入" }),
    ]),
    h("div", { className: "network-route-trunk", "aria-hidden": "true" }),
    h("div", { className: "network-branches" }, network.access_switches.map((item) => h("article", { className: "network-branch" }, [
      h("button", {
        type: "button",
        className: "network-switch-node",
        "aria-label": `查看 ${item.id} 弱电链路`,
        onClick: () => setRoute("topology", item.id),
      }, [h("strong", { text: item.id }), h("small", { text: item.uplink })]),
      h("span", { className: "network-drop", "aria-hidden": "true" }),
      h("div", { className: "network-rack-links" }, item.connected_rack_ids.map((rackId) => h("button", {
        type: "button",
        className: "network-rack-node",
        "aria-label": `查看 ${rackId} 弱电链路`,
        onClick: () => setRoute("topology", rackId),
      }, [h("strong", { text: rackId }), h("small", { text: rackById.get(rackId)?.source_id ?? "来源未知" })]))),
    ]))),
  ]);
}

export function renderOverview(container, state) {
  const serverRacks = state.racks.filter((rack) => rack.role === "server");
  const activeAlarms = state.alarms.filter((alarm) => alarm.status !== "resolved");
  const totalDesign = sum(serverRacks.map((rack) => rack.capacity), "design_power_w");
  const totalUsed = sum(serverRacks.map((rack) => rack.capacity), "rated_power_used_w");
  const usedU = sum(serverRacks.map((rack) => rack.capacity), "used_u");
  const usableU = sum(serverRacks.map((rack) => rack.capacity), "usable_u");

  const hero = h("section", { className: "room-hero" }, [
    h("div", { className: "room-identity" }, [
      h("div", {}, [
        h("p", { className: "section-kicker", text: "L5 / A2 / ROOM 08" }),
        h("h2", { text: "22 柜容量与链路态势" }),
        h("p", { text: "基于系统图和平面图的设计容量。实时采集尚未接入时，功率显示为未知，不按零值处理。" }),
      ]),
      h("div", { className: "hero-sources" }, [sourceBadge("design"), sourceBadge("rule"), sourceBadge("unknown")]),
    ]),
    h("div", { className: "hero-gauge" }, [
      h("span", { text: "额定功率占设计上限" }),
      h("strong", { text: `${Math.round(totalDesign ? totalUsed / totalDesign * 100 : 0)}%` }),
      progressBar(totalUsed, totalDesign, `${formatPower(totalUsed)} / ${formatPower(totalDesign)}`),
    ]),
  ]);

  const metrics = h("section", { className: "metrics-grid" }, [
    metricCard("服务器机柜", `${serverRacks.length} 柜`, "另有 2 个网络机柜", { source: "design" }),
    metricCard("可用 U 位", `${usableU - usedU}U`, `已使用 ${usedU}U / 总可用 ${usableU}U`, { source: "rule" }),
    metricCard("活动报警", `${activeAlarms.length} 项`, activeAlarms.length ? "进入报警诊断查看影响链" : "当前无活动报警", { tone: activeAlarms.length ? "warning" : "ok", source: "rule" }),
    metricCard("实时功率", "未接入", "已预留采集适配器与来源标识", { source: "unknown" }),
  ]);

  const floorPlan = panel("机柜平面与功率母线", h("div", { className: "floor-plan" }, [
    sourceGroup("JG1", state.racks, state.alarms),
    sourceGroup("JG2", state.racks, state.alarms),
    sourceGroup("KT1", state.racks, state.alarms),
    h("div", { className: "plan-legend" }, [
      statusBadge("正常", "ok"),
      statusBadge("容量预警", "warning"),
      statusBadge("阻断/报警", "danger"),
      h("span", { text: "颜色取 U 位与额定功率中的更高风险；点击查看服务器明细" }),
    ]),
  ]), { kicker: "SINGLE-LINE FLOOR MAP", className: "floor-panel" });

  const alarmBody = activeAlarms.length
    ? h("div", { className: "alarm-brief-list" }, activeAlarms.slice(0, 4).map((alarm) => h("button", {
      type: "button",
      className: "alarm-brief",
      onClick: () => setRoute("alarms", alarm.id),
    }, [statusBadge(alarm.severity, alarm.severity === "critical" ? "danger" : "warning"), h("strong", { text: alarm.trigger_code }), h("span", { text: alarm.object_id })])))
    : emptyState("系统处于可演示状态", "可在报警诊断页触发功率过高、采集离线等闭环场景。");

  const alarmPanel = panel("当前风险", alarmBody, {
    kicker: "ACTIVE CONDITIONS",
    action: h("button", { type: "button", className: "text-button", text: "进入报警诊断 →", onClick: () => setRoute("alarms") }),
  });

  const networkPanel = panel("弱电路由视图", networkRouteMap(state.topologyNetwork, state.racks), {
    kicker: "CORE → ACCESS → RACK",
    className: "network-route-panel",
  });

  container.replaceChildren(hero, metrics, h("section", { className: "overview-grid" }, [floorPlan, alarmPanel]), networkPanel);
}
