import {
  detailList,
  formatPower,
  h,
  panel,
  progressBar,
  showToast,
  sourceBadge,
  statusBadge,
} from "../components.js";
import { createRemovalPlan, loadDeviceTopology, setRoute } from "../state.js";

function cssColorToRgba(color, alpha) {
  if (!color) return null;
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith("hsl")) {
    const matched = color.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
    if (matched) return `hsla(${matched[1]}, ${matched[2]}%, ${matched[3]}%, ${alpha})`;
  }
  return color;
}

function gridRow(layer, startU, endU) {
  return `${layer.end_u - endU + 1} / span ${endU - startU + 1}`;
}

function deviceBlock(device, layer) {
  const placement = device.placement;
  const label = device.it_code ? `${device.hostname || device.id} / IT-Code: ${device.it_code}` : (device.hostname || device.id);
  const color = device.color;
  const baseStyle = { gridRow: gridRow(layer, placement.start_u, placement.end_u) };
  const style = color ? {
    ...baseStyle,
    background: `linear-gradient(90deg, ${cssColorToRgba(color, 0.24)}, ${cssColorToRgba(color, 0.08)})`,
    borderColor: cssColorToRgba(color, 0.58),
    borderLeftColor: color,
  } : baseStyle;
  return h("button", {
    type: "button",
    className: "device-block",
    style,
    "data-start-u": placement.start_u,
    "data-end-u": placement.end_u,
    "data-device-id": device.id,
    "data-removable": Boolean(device.movable && device.criticality !== "critical" && device.maintenance_window),
    onClick: () => loadDeviceTopology(device.id),
    "aria-label": `查看服务器 ${label}，${device.rack_id}，U${placement.start_u} 至 U${placement.end_u}`,
  }, [
    h("span", { className: "device-name", text: label }),
    h("span", { className: "device-meta", text: `U${placement.start_u}–U${placement.end_u} · ${formatPower(device.rated_power_w)}` }),
  ]);
}

function rackLayer(layer) {
  const ticks = Array.from({ length: layer.capacity_u }, (_, index) => layer.end_u - index);
  return h("section", {
    className: "rack-layer",
    "data-layer-id": layer.id,
    style: { "--layer-u-count": layer.capacity_u },
  }, [
    h("div", { className: "layer-title" }, [
      h("span", { text: `${layer.id} · U${layer.start_u}–U${layer.end_u}` }),
      h("span", { text: `已用 ${layer.used_u}U · 连续空闲 ${Math.max(0, ...layer.free_intervals.map((item) => item.size_u))}U` }),
    ]),
    h("div", { className: "u-axis", "aria-hidden": "true" }, ticks.map((u) => h("span", { text: `U${String(u).padStart(2, "0")}` }))),
    h("div", { className: "device-grid" }, [
      ...layer.free_intervals.map((interval) => h("div", {
        className: "u-empty",
        style: { gridRow: gridRow(layer, interval.start_u, interval.end_u) },
        "data-start-u": interval.start_u,
        "data-end-u": interval.end_u,
        text: interval.size_u > 1 ? `空闲 U${interval.start_u}–U${interval.end_u}` : `空闲 U${interval.start_u}`,
      })),
      ...layer.devices.map((device) => deviceBlock(device, layer)),
      h("div", {
        className: "u-reserve",
        style: { gridRow: gridRow(layer, layer.reserve_start_u, layer.reserve_end_u) },
        "data-start-u": layer.reserve_start_u,
        "data-end-u": layer.reserve_end_u,
        text: `预留 U${layer.reserve_start_u}–U${layer.reserve_end_u} / 本层一次`,
      }),
    ]),
  ]);
}

function deviceDrawer(topology, state) {
  if (!topology) {
    return h("aside", { className: "device-drawer is-empty" }, [
      h("p", { className: "section-kicker", text: "服务器详情" }),
      h("h3", { text: "选择一台服务器" }),
      h("p", { text: "服务器信息、PDU 出线、交换机端口和业务归属将在这里显示。" }),
    ]);
  }
  const device = topology.device;
  const pdu = topology.power.find((node) => node.type === "pdu");
  const access = topology.network.find((node) => node.type === "access_switch");
  const eligible = Boolean(device.movable && device.criticality !== "critical" && device.maintenance_window);
  const removalButton = h("button", {
    type: "button",
    className: "primary-button removal-plan-button",
    text: "生成取出方案",
    disabled: state.session.role !== "admin",
    onClick: async (event) => {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = "正在校验取出约束…";
      try {
        await createRemovalPlan(device);
      } catch (error) {
        event.currentTarget.disabled = state.session.role !== "admin";
        event.currentTarget.textContent = "生成取出方案";
        showToast(`${error.code ?? "REMOVAL_PLAN_FAILED"} · ${error.message}`, "danger");
      }
    },
  });
  return h("aside", { className: "device-drawer" }, [
    h("div", { className: "drawer-head" }, [
      h("div", {}, [h("p", { className: "section-kicker", text: device.id }), h("h3", { text: device.hostname || device.id })]),
      sourceBadge(device.data_source),
    ]),
    detailList([
      ["IT-Code", device.it_code], ["资产编号", device.asset_id], ["设备型号", device.model], ["序列号", device.serial],
      ["机柜 / 层", `${device.rack_id} / ${device.layer_id}`], ["U 位", `U${device.start_u}–U${device.start_u + device.u_size - 1}`], ["设备高度", device.u_size, "demo"],
      ["额定功率", formatPower(device.rated_power_w), "demo"], ["实时功率", device.real_power_w === null ? "未接入" : formatPower(device.real_power_w), device.real_power_w === null ? "unknown" : "telemetry"],
      ["重量", `${device.weight_kg} kg`], ["网络端口", device.network_ports], ["IP / VLAN", `${device.ip} / ${device.vlan}`],
      ["PDU 出线", pdu?.label], ["交换机端口", access ? `${access.id} / ${access.details.switch_port}` : null],
      ["承载业务", device.business], ["责任人", device.owner], ["运行状态", device.status],
      ["可取出", eligible ? "满足基础条件" : "存在硬阻断"], ["维护窗口", device.maintenance_window],
      ["业务副本组", device.replica_group],
    ]),
    h("div", { className: "drawer-actions" }, [
      h("button", { type: "button", className: "secondary-button", text: "查看链路", onClick: () => setRoute("topology", device.id) }),
      h("button", { type: "button", className: "secondary-button", text: "相关审计", onClick: () => setRoute("audit", device.id) }),
      removalButton,
    ]),
    h("p", {
      className: `removal-eligibility ${eligible ? "is-ready" : "is-blocked"}`,
      text: eligible
        ? "取出方案仍会复核业务副本与当前快照，并保留一次最终确认。"
        : "当前设备缺少可移动标记、维护窗口或属于关键设备；可生成方案查看具体阻断，但不能执行。",
    }),
    h("p", { className: "redundancy-note", text: `冗余状态：${topology.redundancy === "unverified" ? "未核实，不声明 A/B 冗余" : topology.redundancy}` }),
  ]);
}

export function renderRackDetail(container, state) {
  const rack = state.selectedRack;
  if (!rack) return;
  const capacity = rack.capacity;
  const header = h("section", { className: "rack-detail-head" }, [
    h("button", { type: "button", className: "back-button", text: "← 返回机房总览", onClick: () => setRoute("overview") }),
    h("div", { className: "rack-title-row" }, [
      h("div", {}, [
        h("p", { className: "section-kicker", text: `${rack.source_id} / ${rack.role === "network" ? "网络" : "服务器"}机柜` }),
        h("h2", { text: `${rack.id} · ${rack.name}` }),
        h("p", { text: `${rack.height_u}U · 分层线 ${rack.dividers_u.join(" / ")}U · 每层仅预留一次 2U` }),
      ]),
      h("div", { className: "rack-head-badges" }, [sourceBadge(rack.data_source), statusBadge(rack.role === "network" ? "网络机柜" : "服务器机柜", "neutral")]),
    ]),
  ]);

  const capacityPanel = panel("容量边界", h("div", { className: "capacity-stack" }, [
    progressBar(capacity.rated_power_used_w, capacity.design_power_w, `额定功率 ${formatPower(capacity.rated_power_used_w)} / ${formatPower(capacity.design_power_w)}`),
    progressBar(capacity.used_u, capacity.usable_u, `U 位 ${capacity.used_u}U / ${capacity.usable_u}U`),
    progressBar(capacity.used_weight_kg, capacity.max_weight_kg, `重量 ${capacity.used_weight_kg} / ${capacity.max_weight_kg} kg`),
    progressBar(capacity.used_ports, capacity.port_limit, `网口 ${capacity.used_ports} / ${capacity.port_limit}`),
    h("div", { className: "telemetry-note" }, [sourceBadge(capacity.real_power_source), h("span", { text: `实时功率：${formatPower(capacity.real_power_w)}` })]),
  ]), { kicker: "硬约束上限" });

  const rackVisual = panel("42U 四层视图", h("div", { className: "rack-frame" }, [...rack.layers].reverse().map(rackLayer)), {
    kicker: "物理机柜",
    className: "rack-visual-panel",
  });

  container.replaceChildren(header, h("section", { className: "rack-detail-grid" }, [
    h("div", { className: "rack-left-column" }, [capacityPanel, rackVisual]),
    deviceDrawer(state.selectedDeviceTopology, state),
  ]));
}
