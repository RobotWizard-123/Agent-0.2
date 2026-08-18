import { detailList, emptyState, h, openDialog, panel, showToast, sourceBadge, statusBadge } from "../components.js";
import { loadTopology, selectTopologyDevice } from "../state.js";

async function queryTopology(id) {
  try {
    await loadTopology(id);
  } catch (error) {
    showToast(`${error.code ?? "TOPOLOGY_FAILED"} · ${error.message}`, "danger");
  }
}

function queryButton(id, label, children, className = "aggregate-node") {
  return h("button", {
    type: "button",
    className,
    "aria-label": label,
    onClick: () => queryTopology(id),
  }, children);
}

function pathNode(node, index, total) {
  return h("div", { className: "path-segment" }, [
    h("article", { className: `path-node node-${node.type}` }, [
      h("div", { className: "path-node-head" }, [h("span", { text: node.type }), sourceBadge(node.source)]),
      h("strong", { text: node.label ?? node.id ?? "未知节点" }),
      h("code", { text: node.id ?? "UNKNOWN" }),
      Object.keys(node.details ?? {}).length ? h("small", { text: Object.entries(node.details).map(([key, value]) => `${key}: ${value}`).join(" · ") }) : null,
    ]),
    index < total - 1 ? h("span", { className: "path-link", "aria-hidden": "true" }) : null,
  ]);
}

function pathPanel(title, nodes, tone) {
  return panel(title, nodes?.length
    ? h("div", { className: `topology-path path-${tone}` }, nodes.map((node, index) => pathNode(node, index, nodes.length)))
    : emptyState("链路信息未接入", "系统保留未知节点，不会推测或补造实际连接。"), { kicker: tone === "power" ? "强电路径" : "网络路径" });
}

function openDeviceDetailDialog(device, rack) {
  const rackId = rack ? rack.id : "—";
  const rackLabel = rack && (rack.name || rack.alias) ? rack.name || rack.alias : "—";
  const content = h("div", { className: "device-detail-dialog" }, [
    h("p", { className: "section-kicker", text: "设备详情" }),
    h("h2", { text: device.id }),
    detailList([
      ["设备编号", device.id],
      ["IT-Code", device.it_code],
      ["主机名", device.hostname],
      ["机柜", `${rackId} / ${rackLabel}`],
      ["层级", device.layer_id],
      ["起始 U 位", device.start_u],
      ["U 数", device.u_size],
      ["业务归属", device.business_id],
      ["副本组", device.replica_group],
      ["维护窗口", device.maintenance_window],
      ["数据来源", device.data_source],
      ["状态", device.status],
    ]),
  ]);
  openDialog(content, { label: `设备详情 ${device.id}` });
}

function deviceLocationCard(device, rack) {
  const color = device.color || "var(--steel-300)";
  return h("button", {
    type: "button",
    className: "device-location-card",
    "aria-label": `查看 ${device.id} 详情`,
    onClick: () => openDeviceDetailDialog(device, rack),
  }, [
    h("div", { className: "device-location-header" }, [
      h("strong", { text: rack.id }),
      sourceBadge(device.data_source),
    ]),
    h("span", { className: "device-location-name", text: rack.name || rack.alias || "" }),
    h("span", { className: "device-location-position", text: `位置：${device.layer_id || "—"} / U${device.start_u ?? "—"}` }),
    h("span", { className: "device-location-id", style: { color }, text: `设备编号：${device.id}` }),
    h("span", { className: "device-location-itcode", style: { color }, text: `IT-Code：${device.it_code || "—"}` }),
  ]);
}

function deviceTopology(result) {
  const path = result.device;
  const deviceLabel = path.device.it_code
    ? `${path.device.hostname || path.device.id} / IT-Code: ${path.device.it_code}`
    : (path.device.hostname || path.device.id);
  return h("div", { className: "topology-results" }, [
    h("section", { className: "topology-subject" }, [
      h("div", {}, [h("p", { className: "section-kicker", text: path.device.id }), h("h2", { text: deviceLabel }), h("p", { text: `${path.rack?.id ?? "未知机柜"} / ${path.device.layer_id}` })]),
      h("div", { className: "intro-badges" }, [sourceBadge(path.device.data_source), statusBadge("冗余未核实", "warning")]),
    ]),
    h("section", { className: "device-location-section" }, [
      h("h3", { text: "服务器位置" }),
      deviceLocationCard(path.device, path.rack),
    ]),
    h("section", { className: "topology-columns" }, [pathPanel("强电路径", path.power, "power"), pathPanel("网络路径", path.network, "network")]),
    h("p", { className: "redundancy-callout", text: "图纸存在多条配电分支，但当前数据不足以证明设备级 A/B 冗余，本系统不作冗余承诺。" }),
  ]);
}

function rackById(racks, rackId) {
  for (const rack of racks) {
    if (rack.id === rackId) return rack;
  }
  return null;
}

function selectableDeviceCard(device, racks, selected) {
  const rack = rackById(racks, device.rack_id);
  const color = device.color || "var(--steel-300)";
  const className = selected ? "device-location-card device-match-card selected" : "device-location-card device-match-card";
  async function onCardClick() {
    await selectTopologyDevice(device.id);
    openDeviceDetailDialog(device, rack);
  }
  return h("button", {
    type: "button",
    className,
    "aria-label": `查看 ${device.id} 详情`,
    onClick: onCardClick,
  }, [
    h("div", { className: "device-location-header" }, [
      h("strong", { text: rack ? rack.id : "未知机柜" }),
      sourceBadge(device.data_source),
    ]),
    h("span", { className: "device-location-name", text: rack ? (rack.name || rack.alias || "") : "" }),
    h("span", { className: "device-location-position", text: `位置：${device.layer_id || "—"} / U${device.start_u ?? "—"}` }),
    h("span", { className: "device-location-id", style: { color }, text: `设备编号：${device.id}` }),
    h("span", { className: "device-location-itcode", style: { color }, text: `IT-Code：${device.it_code || "—"}` }),
  ]);
}

function multiDeviceTopology(result, racks) {
  const path = result.selectedPath;
  const device = path ? path.device : null;
  const deviceLabel = device && device.it_code
    ? `${device.hostname || device.id} / IT-Code: ${device.it_code}`
    : (device ? (device.hostname || device.id) : result.devices[0].id);
  const subjectLine = device
    ? `${path.rack ? path.rack.id : "未知机柜"} / ${device.layer_id}`
    : `查询 "${result.query}" 命中 ${result.devices.length} 台服务器，点击卡片查看链路。`;

  return h("div", { className: "topology-results" }, [
    h("section", { className: "topology-subject" }, [
      h("div", {}, [
        h("p", { className: "section-kicker", text: device ? device.id : "多设备匹配" }),
        h("h2", { text: deviceLabel }),
        h("p", { text: subjectLine }),
      ]),
      h("div", { className: "intro-badges" }, [sourceBadge(device ? device.data_source : "design"), statusBadge("多匹配", "neutral")]),
    ]),
    h("section", { className: "device-location-section" }, [
      h("h3", { text: "服务器位置" }),
      h("div", { className: "device-match-list" }, result.devices.map((d) => selectableDeviceCard(d, racks, d.id === result.selectedId))),
    ]),
    path ? h("section", { className: "topology-columns" }, [pathPanel("强电路径", path.power, "power"), pathPanel("网络路径", path.network, "network")]) : null,
    h("p", { className: "redundancy-callout", text: "图纸存在多条配电分支，但当前数据不足以证明设备级 A/B 冗余，本系统不作冗余承诺。" }),
  ]);
}

function matchAggregate(result) {
  const query = result.query.toUpperCase();
  const power = result.power;
  const network = result.network;
  let racks = power.cabinets;
  let sources = power.power_sources;
  let switches = network.access_switches;

  if (query.startsWith("CAB-")) {
    racks = power.cabinets.filter((rack) => rack.id === query);
    sources = power.power_sources.filter((source) => racks.some((rack) => rack.source_id === source.id));
    switches = network.access_switches.filter((item) => item.connected_rack_ids.includes(query));
  } else if (query.startsWith("JG") || query === "KT1") {
    sources = power.power_sources.filter((source) => source.id === query);
    racks = power.cabinets.filter((rack) => rack.source_id === query);
    const rackIds = new Set(racks.map((rack) => rack.id));
    switches = network.access_switches.filter((item) => item.connected_rack_ids.some((rackId) => rackIds.has(rackId)));
  } else if (query.startsWith("ASW-")) {
    switches = network.access_switches.filter((item) => item.id === query);
    const rackIds = new Set(switches.flatMap((item) => item.connected_rack_ids));
    racks = power.cabinets.filter((rack) => rackIds.has(rack.id));
    sources = power.power_sources.filter((source) => racks.some((rack) => rack.source_id === source.id));
  } else if (query && query !== network.core.id) {
    racks = [];
    sources = [];
    switches = [];
  }
  return { racks, sources, switches };
}

function aggregateTopology(result) {
  const { racks, sources, switches } = matchAggregate(result);
  const network = result.network;
  const selection = h("section", { className: "topology-selection" }, [
    h("div", {}, [
      h("p", { className: "section-kicker", text: "已选追踪" }),
      h("strong", { text: result.query || "全部设计对象" }),
      h("span", { text: `命中 ${sources.length} 个电源、${racks.length} 个机柜、${switches.length} 台接入交换机` }),
    ]),
    statusBadge(sources.length + racks.length + switches.length ? "关联对象已联动" : "未找到对象", sources.length + racks.length + switches.length ? "ok" : "warning"),
  ]);
  const powerBody = h("div", { className: "aggregate-map" }, [
    ...sources.map((source) => queryButton(source.id, `查看 ${source.id} 链路`, [sourceBadge(source.data_source), h("strong", { text: source.id }), h("span", { text: source.name }), h("code", { text: source.calculated_load_w === null ? "计算负载：未接入" : `图纸计算负载 ${(source.calculated_load_w / 1000).toFixed(0)} kW` })], "aggregate-node power-source-node")),
    ...racks.map((rack) => queryButton(rack.id, `查看 ${rack.id} 链路`, [h("strong", { text: rack.id }), h("span", { text: `${rack.source_id} · ${(rack.design_power_w / 1000).toFixed(0)} kW` })])),
  ]);
  const networkBody = h("div", { className: "aggregate-map" }, [
    queryButton(network.core.id, `查看 ${network.core.id} 链路`, [sourceBadge(network.core.data_source), h("strong", { text: network.core.id }), h("span", { text: network.core.name })], "aggregate-node core-node"),
    ...switches.map((item) => queryButton(item.id, `查看 ${item.id} 链路`, [sourceBadge(item.data_source), h("strong", { text: item.id }), h("span", { text: `${item.uplink} → ${item.connected_rack_ids.join(" / ")}` })], "aggregate-node network-node")),
  ]);
  return h("div", { className: "topology-results" }, [
    selection,
    h("section", { className: "topology-columns" }, [panel("强电对象", powerBody, { kicker: "配电对象" }), panel("弱电对象", networkBody, { kicker: "网络对象" })]),
  ]);
}

export function renderTopology(container, state) {
  const form = h("form", { className: "topology-search" }, [
    h("label", { className: "form-field" }, ["设备、机柜、电源或交换机", h("input", { name: "query", value: state.topologyResult?.query || state.route.id || "SRV-DEMO-10U", placeholder: "设备编号 / IT-Code / 主机名 / 机柜名称 / 电源或交换机" })]),
    h("button", { type: "submit", className: "primary-button", text: "查询链路" }),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = new FormData(form).get("query");
    try { await loadTopology(query); }
    catch (error) { showToast(`${error.code ?? "TOPOLOGY_FAILED"} · ${error.message}`, "danger"); }
  });

  const quickQueries = h("div", { className: "topology-quick-query" }, [
    h("span", { text: "快速查询" }),
    ...["SRV-DEMO-10U", "CAB-09", "JG1", "ASW-05"].map((id) => queryButton(id, `查询 ${id}`, id, "query-chip")),
  ]);

  const collectorOffline = state.alarms.some((alarm) => alarm.status !== "resolved" && alarm.scenario === "collector_offline");
  const intro = h("section", { className: "view-intro" }, [
    h("div", {}, [h("p", { className: "section-kicker", text: "仅显示已知链路" }), h("h2", { text: "强弱电链路证据" }), h("p", { text: "分别展示配电与网络路径。未知连接保持未知，所有节点显示数据来源。" })]),
    statusBadge(collectorOffline ? "采集离线 · 使用设计数据" : "设计链路可查", collectorOffline ? "warning" : "ok"),
  ]);
  const searchPanel = panel("查询对象", [form, quickQueries], { kicker: "追踪" });
  const result = state.topologyResult
    ? state.topologyResult.kind === "device" ? deviceTopology(state.topologyResult)
      : state.topologyResult.kind === "multi-device" ? multiDeviceTopology(state.topologyResult, state.racks)
        : aggregateTopology(state.topologyResult)
    : emptyState("输入对象开始查询", "默认示例 SRV-DEMO-10U 包含完整的 PDU 与交换机端口链路。");
  container.replaceChildren(intro, searchPanel, result);
}
