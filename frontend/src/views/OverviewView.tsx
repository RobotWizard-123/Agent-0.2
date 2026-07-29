import { useAtomValue, useSetAtom } from "jotai";
import { roomAtom, racksAtom, alarmsAtom } from "../atoms/room";
import { setRouteAction } from "../atoms/ui";
import { rackRisk } from "../utils/rack-risk";
import { formatPower } from "../utils/format";
import { Panel, MetricCard, ProgressBar, SourceBadge, StatusBadge, EmptyState } from "../components/ui";
import type { Rack, Alarm } from "../types/domain";

function sum(items: { capacity: Record<string, number> }[], field: string): number {
  return items.reduce((total, item) => total + Number(item.capacity[field] || 0), 0);
}

function RackCard({ rack, alarms }: { rack: Rack; alarms: Alarm[] }) {
  const setRoute = useSetAtom(setRouteAction);
  const risk = rackRisk(rack, alarms);
  return (
    <button
      type="button"
      className={`rack-card rack-${risk.tone}`}
      data-rack-id={rack.id}
      aria-label={`查看 ${rack.id} 机柜详情`}
      onClick={() => setRoute({ name: "rack", id: rack.id })}
    >
      <span className="rack-card-top">
        <strong>{rack.id}</strong>
        <i className="status-dot" aria-hidden="true" />
      </span>
      <span className="rack-role">{rack.role === "network" ? rack.alias ?? "网络柜" : rack.source_id}</span>
      <span className="rack-power">{formatPower(rack.capacity.rated_power_used_w)} / {formatPower(rack.capacity.design_power_w)}</span>
      <span className="rack-u">{rack.capacity.used_u} / {rack.capacity.usable_u}U</span>
      <span className="rack-risk">{risk.basis} {Math.round(risk.ratio * 100)}%</span>
    </button>
  );
}

function SourceGroup({ sourceId, racks, alarms }: { sourceId: string; racks: Rack[]; alarms: Alarm[] }) {
  const items = racks.filter((r) => r.source_id === sourceId);
  const design = sum(items as { capacity: Record<string, number> }[], "design_power_w");
  const used = sum(items as { capacity: Record<string, number> }[], "rated_power_used_w");
  return (
    <section className={`source-group source-${sourceId.toLowerCase()}`}>
      <div className="bus-rail">
        <span className="bus-label">{sourceId}</span>
        <span className="bus-line" />
        <span className="bus-value">{formatPower(used)} / {formatPower(design)}</span>
      </div>
      <div className="rack-row">
        {items.map((rack) => <RackCard key={rack.id} rack={rack} alarms={alarms} />)}
      </div>
    </section>
  );
}

export function OverviewView() {
  const room = useAtomValue(roomAtom);
  const racks = useAtomValue(racksAtom);
  const alarms = useAtomValue(alarmsAtom);
  const setRoute = useSetAtom(setRouteAction);

  const serverRacks = racks.filter((r) => r.role === "server");
  const activeAlarms = alarms.filter((a) => a.status !== "resolved");
  const totalDesign = sum(serverRacks as { capacity: Record<string, number> }[], "design_power_w");
  const totalUsed = sum(serverRacks as { capacity: Record<string, number> }[], "rated_power_used_w");
  const usedU = sum(serverRacks as { capacity: Record<string, number> }[], "used_u");
  const usableU = sum(serverRacks as { capacity: Record<string, number> }[], "usable_u");

  return (
    <>
      <section className="room-hero">
        <div className="room-identity">
          <div>
            <p className="section-kicker">L5 / A2 / ROOM 08</p>
            <h2>22 柜容量与链路态势</h2>
            <p>基于系统图和平面图的设计容量。实时采集尚未接入时，功率显示为未知，不按零值处理。</p>
          </div>
          <div className="hero-sources">
            <SourceBadge source="design" />
            <SourceBadge source="rule" />
            <SourceBadge source="unknown" />
          </div>
        </div>
        <div className="hero-gauge">
          <span>额定功率占设计上限</span>
          <strong>{Math.round(totalDesign ? (totalUsed / totalDesign) * 100 : 0)}%</strong>
          <ProgressBar value={totalUsed} max={totalDesign} label={`${formatPower(totalUsed)} / ${formatPower(totalDesign)}`} />
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="服务器机柜" value={`${serverRacks.length} 柜`} detail="另有 2 个网络机柜" source="design" />
        <MetricCard label="可用 U 位" value={`${usableU - usedU}U`} detail={`已使用 ${usedU}U / 总可用 ${usableU}U`} source="rule" />
        <MetricCard
          label="活动报警"
          value={`${activeAlarms.length} 项`}
          detail={activeAlarms.length ? "进入报警诊断查看影响链" : "当前无活动报警"}
          tone={activeAlarms.length ? "warning" : "ok"}
          source="rule"
        />
        <MetricCard label="实时功率" value="未接入" detail="已预留采集适配器与来源标识" source="unknown" />
      </section>

      <section className="overview-grid">
        <Panel title="机柜平面与功率母线" kicker="SINGLE-LINE FLOOR MAP" className="floor-panel">
          <div className="floor-plan">
            <SourceGroup sourceId="JG1" racks={racks} alarms={alarms} />
            <SourceGroup sourceId="JG2" racks={racks} alarms={alarms} />
            <SourceGroup sourceId="KT1" racks={racks} alarms={alarms} />
            <div className="plan-legend">
              <StatusBadge label="正常" tone="ok" />
              <StatusBadge label="容量预警" tone="warning" />
              <StatusBadge label="阻断/报警" tone="danger" />
              <span>颜色取 U 位与额定功率中的更高风险；点击查看服务器明细</span>
            </div>
          </div>
        </Panel>
        <Panel
          title="当前风险"
          kicker="ACTIVE CONDITIONS"
          action={<button type="button" className="text-button" onClick={() => setRoute({ name: "alarms", id: null })}>进入报警诊断 →</button>}
        >
          {activeAlarms.length ? (
            <div className="alarm-brief-list">
              {activeAlarms.slice(0, 4).map((alarm) => (
                <button key={alarm.id} type="button" className="alarm-brief" onClick={() => setRoute({ name: "alarms", id: alarm.id })}>
                  <StatusBadge label={alarm.severity} tone={alarm.severity === "critical" ? "danger" : "warning"} />
                  <strong>{alarm.trigger_code}</strong>
                  <span>{alarm.object_id}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="系统处于可演示状态" detail="可在报警诊断页触发功率过高、采集离线等闭环场景。" />
          )}
        </Panel>
      </section>

      <Panel title="弱电路由视图" kicker="CORE → ACCESS → RACK" className="network-route-panel">
        <EmptyState title="弱电路由数据未接入" detail="已保留核心、接入交换机与机柜的展示接口。" />
      </Panel>
    </>
  );
}
