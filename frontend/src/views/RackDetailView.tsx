import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedRackAtom, loadRackAction, loadDeviceTopologyAction, selectedDeviceTopologyAtom } from "../atoms/racks";
import { routeAtom, setRouteAction, showToastAction } from "../atoms/ui";
import { sessionAtom } from "../atoms/auth";
import { createRemovalPlanAction } from "../atoms/plans";
import { Panel, ProgressBar, DetailList, SourceBadge, StatusBadge, Button, LoadingState } from "../components/ui";
import { formatPower } from "../utils/format";
import type { RackLayer, RackDevice } from "../types/domain";

function gridRow(layer: RackLayer, startU: number, endU: number): string {
  return `${layer.end_u - endU + 1} / span ${endU - startU + 1}`;
}

function DeviceBlock({ device, layer }: { device: RackDevice; layer: RackLayer }) {
  const loadTopology = useSetAtom(loadDeviceTopologyAction);
  const placement = device.placement;
  if (!placement) return null;
  return (
    <button
      type="button"
      className="device-block"
      style={{ gridRow: gridRow(layer, placement.start_u, placement.end_u) }}
      data-device-id={device.id}
      aria-label={`查看服务器 ${device.hostname || device.id}，${device.rack_id}，U${placement.start_u} 至 U${placement.end_u}`}
      onClick={() => loadTopology(device.id)}
    >
      <span className="device-name">{device.hostname || device.id}</span>
      <span className="device-meta">{`U${placement.start_u}–U${placement.end_u} · ${formatPower(device.rated_power_w)}`}</span>
    </button>
  );
}

function RackLayerView({ layer }: { layer: RackLayer }) {
  const ticks = Array.from({ length: layer.capacity_u }, (_, i) => layer.end_u - i);
  const largestFree = Math.max(0, ...(layer.free_intervals ?? []).map((iv) => iv.size_u));
  return (
    <section className="rack-layer" data-layer-id={layer.id} style={{ ["--layer-u-count" as string]: layer.capacity_u }}>
      <div className="layer-title">
        <span>{`${layer.id} · U${layer.start_u}–U${layer.end_u}`}</span>
        <span>{`已用 ${layer.used_u ?? 0}U · 连续空闲 ${largestFree}U`}</span>
      </div>
      <div className="u-axis" aria-hidden="true">
        {ticks.map((u) => <span key={u}>{`U${String(u).padStart(2, "0")}`}</span>)}
      </div>
      <div className="device-grid">
        {(layer.free_intervals ?? []).map((interval, i) => (
          <div
            key={`free-${i}`}
            className="u-empty"
            style={{ gridRow: gridRow(layer, interval.start_u, interval.end_u) }}
          >
            {interval.size_u > 1 ? `空闲 U${interval.start_u}–U${interval.end_u}` : `空闲 U${interval.start_u}`}
          </div>
        ))}
        {(layer.devices ?? []).map((device) => <DeviceBlock key={device.id} device={device} layer={layer} />)}
        <div
          className="u-reserve"
          style={{ gridRow: gridRow(layer, layer.reserve_start_u, layer.reserve_end_u) }}
        >
          {`预留 U${layer.reserve_start_u}–U${layer.reserve_end_u} / 本层一次`}
        </div>
      </div>
    </section>
  );
}

function DeviceDrawer() {
  const topology = useAtomValue(selectedDeviceTopologyAtom);
  const setRoute = useSetAtom(setRouteAction);
  const session = useAtomValue(sessionAtom);
  const createRemoval = useSetAtom(createRemovalPlanAction);
  const showToast = useSetAtom(showToastAction);

  if (!topology) {
    return (
      <aside className="device-drawer is-empty">
        <p className="section-kicker">SERVER DETAIL</p>
        <h3>选择一台服务器</h3>
        <p>服务器信息、PDU 出线、交换机端口和业务归属将在这里显示。</p>
      </aside>
    );
  }

  const device = topology.device;
  const pdu = topology.power.find((n) => n.type === "pdu");
  const access = topology.network.find((n) => n.type === "access_switch");
  const eligible = Boolean(device.movable && device.criticality !== "critical" && device.maintenance_window);

  const handleRemoval = async () => {
    try {
      await createRemoval({
        id: device.id,
        rack_id: device.rack_id,
        hostname: device.hostname,
        business_id: device.business_id,
        replica_group: device.replica_group,
        maintenance_window: device.maintenance_window,
      });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      showToast({ message: `${e.code ?? "REMOVAL_PLAN_FAILED"} · ${e.message ?? "请求失败"}`, tone: "danger" });
    }
  };

  return (
    <aside className="device-drawer">
      <div className="drawer-head">
        <div>
          <p className="section-kicker">{device.id}</p>
          <h3>{device.hostname || device.id}</h3>
        </div>
        <SourceBadge source={device.data_source} />
      </div>
      <DetailList
        items={[
          ["资产编号", device.asset_id],
          ["设备型号", device.model],
          ["序列号", device.serial],
          ["机柜 / 层", `${device.rack_id} / ${device.layer_id}`],
          ["U 位", `U${device.start_u}–U${device.start_u + device.u_size - 1}`],
          ["设备高度", device.u_size, "demo"],
          ["额定功率", formatPower(device.rated_power_w), "demo"],
          ["实时功率", device.real_power_w === null ? "未接入" : formatPower(device.real_power_w), device.real_power_w === null ? "unknown" : "telemetry"],
          ["重量", `${device.weight_kg} kg`],
          ["网络端口", device.network_ports],
          ["IP / VLAN", `${device.ip} / ${device.vlan}`],
          ["PDU 出线", pdu?.label],
          ["交换机端口", access ? `${access.id} / ${access.details?.switch_port}` : null],
          ["承载业务", device.business],
          ["责任人", device.owner],
          ["运行状态", device.status],
          ["可取出", eligible ? "满足基础条件" : "存在硬阻断"],
          ["维护窗口", device.maintenance_window],
          ["业务副本组", device.replica_group],
        ]}
      />
      <div className="drawer-actions">
        <Button variant="secondary" onClick={() => setRoute({ name: "topology", id: device.id })}>查看链路</Button>
        <Button variant="secondary" onClick={() => setRoute({ name: "audit", id: device.id })}>相关审计</Button>
        <Button variant="primary" disabled={session.role !== "admin"} onClick={handleRemoval}>
          生成取出方案
        </Button>
      </div>
      <p className={`removal-eligibility ${eligible ? "is-ready" : "is-blocked"}`}>
        {eligible
          ? "取出方案仍会复核业务副本与当前快照，并保留一次最终确认。"
          : "当前设备缺少可移动标记、维护窗口或属于关键设备；可生成方案查看具体阻断，但不能执行。"}
      </p>
      <p className="redundancy-note">
        {`冗余状态：${topology.redundancy === "unverified" ? "未核实，不声明 A/B 冗余" : topology.redundancy}`}
      </p>
    </aside>
  );
}

export function RackDetailView() {
  const rack = useAtomValue(selectedRackAtom);
  const route = useAtomValue(routeAtom);
  const loadRack = useSetAtom(loadRackAction);
  const setRoute = useSetAtom(setRouteAction);

  useEffect(() => {
    if (route.id) loadRack(route.id);
  }, [route.id, loadRack]);

  if (!rack) return <LoadingState label={`正在读取 ${route.id ?? ""} 机柜`} />;

  const capacity = rack.capacity;

  return (
    <>
      <section className="rack-detail-head">
        <button type="button" className="back-button" onClick={() => setRoute({ name: "overview", id: null })}>← 返回机房总览</button>
        <div className="rack-title-row">
          <div>
            <p className="section-kicker">{`${rack.source_id} / ${rack.role.toUpperCase()} RACK`}</p>
            <h2>{`${rack.id} · ${rack.name}`}</h2>
            <p>{`${rack.height_u}U · 分层线 ${rack.dividers_u.join(" / ")}U · 每层仅预留一次 2U`}</p>
          </div>
          <div className="rack-head-badges">
            <SourceBadge source={rack.data_source} />
            <StatusBadge label={rack.role === "network" ? "网络机柜" : "服务器机柜"} tone="neutral" />
          </div>
        </div>
      </section>
      <section className="rack-detail-grid">
        <div className="rack-left-column">
          <Panel title="容量边界" kicker="HARD LIMITS">
            <div className="capacity-stack">
              <ProgressBar value={capacity.rated_power_used_w} max={capacity.design_power_w} label={`额定功率 ${formatPower(capacity.rated_power_used_w)} / ${formatPower(capacity.design_power_w)}`} />
              <ProgressBar value={capacity.used_u} max={capacity.usable_u} label={`U 位 ${capacity.used_u}U / ${capacity.usable_u}U`} />
              <ProgressBar value={capacity.used_weight_kg} max={capacity.max_weight_kg} label={`重量 ${capacity.used_weight_kg} / ${capacity.max_weight_kg} kg`} />
              <ProgressBar value={capacity.used_ports} max={capacity.port_limit} label={`网口 ${capacity.used_ports} / ${capacity.port_limit}`} />
              <div className="telemetry-note">
                <SourceBadge source={capacity.real_power_source as "design" | "rule" | "demo" | "telemetry" | "unknown"} />
                <span>{`实时功率：${formatPower(capacity.real_power_w)}`}</span>
              </div>
            </div>
          </Panel>
          <Panel title="42U 四层视图" kicker="PHYSICAL RACK" className="rack-visual-panel">
            <div className="rack-frame">
              {[...rack.layers].reverse().map((layer) => <RackLayerView key={layer.id} layer={layer} />)}
            </div>
          </Panel>
        </div>
        <DeviceDrawer />
      </section>
    </>
  );
}
