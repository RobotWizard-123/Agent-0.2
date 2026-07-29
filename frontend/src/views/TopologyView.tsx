import { useState, type FormEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { topologyResultAtom, loadTopologyAction } from "../atoms/topology";
import { alarmsAtom } from "../atoms/room";
import { routeAtom, showToastAction } from "../atoms/ui";
import { Panel, SourceBadge, StatusBadge, EmptyState } from "../components/ui";
import type { TopologyNode } from "../types/domain";

function PathNode({ node, index, total }: { node: TopologyNode; index: number; total: number }) {
  const detailsText = Object.keys(node.details ?? {}).length
    ? Object.entries(node.details).map(([k, v]) => `${k}: ${v}`).join(" · ")
    : null;
  return (
    <div className="path-segment">
      <article className={`path-node node-${node.type}`}>
        <div className="path-node-head">
          <span>{node.type}</span>
          <SourceBadge source={node.source} />
        </div>
        <strong>{node.label ?? node.id ?? "未知节点"}</strong>
        <code>{node.id ?? "UNKNOWN"}</code>
        {detailsText && <small>{detailsText}</small>}
      </article>
      {index < total - 1 && <span className="path-link" aria-hidden="true" />}
    </div>
  );
}

function PathPanel({ title, nodes, tone }: { title: string; nodes: TopologyNode[]; tone: "power" | "network" }) {
  return (
    <Panel title={title} kicker={tone === "power" ? "POWER PATH" : "NETWORK PATH"}>
      {nodes?.length ? (
        <div className={`topology-path path-${tone}`}>
          {nodes.map((node, i) => <PathNode key={i} node={node} index={i} total={nodes.length} />)}
        </div>
      ) : (
        <EmptyState title="链路信息未接入" detail="系统保留未知节点，不会推测或补造实际连接。" />
      )}
    </Panel>
  );
}

export function TopologyView() {
  const result = useAtomValue(topologyResultAtom);
  const alarms = useAtomValue(alarmsAtom);
  const route = useAtomValue(routeAtom);
  const loadTopology = useSetAtom(loadTopologyAction);
  const showToast = useSetAtom(showToastAction);

  const [query, setQuery] = useState(route.id || "SRV-DEMO-10U");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await loadTopology(query);
    } catch (error) {
      const er = error as { code?: string; message?: string };
      showToast({ message: `${er.code ?? "TOPOLOGY_FAILED"} · ${er.message ?? "请求失败"}`, tone: "danger" });
    }
  };

  const collectorOffline = alarms.some((a) => a.status !== "resolved" && a.scenario === "collector_offline");

  return (
    <>
      <section className="view-intro">
        <div>
          <p className="section-kicker">KNOWN LINKS ONLY</p>
          <h2>强弱电链路证据</h2>
          <p>分别展示配电与网络路径。未知连接保持未知，所有节点显示数据来源。</p>
        </div>
        <StatusBadge label={collectorOffline ? "采集离线 · 使用设计数据" : "设计链路可查"} tone={collectorOffline ? "warning" : "ok"} />
      </section>

      <Panel title="查询对象" kicker="TRACE">
        <form className="topology-search" onSubmit={handleSubmit}>
          <label className="form-field">
            设备、机柜、电源或交换机
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SRV-DEMO-10U / CAB-09 / JG1 / ASW-05" />
          </label>
          <button type="submit" className="primary-button">查询链路</button>
        </form>
        <div className="topology-quick-query">
          <span>快速查询</span>
          {["SRV-DEMO-10U", "CAB-09", "JG1", "ASW-05"].map((id) => (
            <button key={id} type="button" className="query-chip" onClick={() => { setQuery(id); loadTopology(id); }}>{id}</button>
          ))}
        </div>
      </Panel>

      {result ? (
        result.kind === "device" && result.device ? (
          <div className="topology-results">
            <section className="topology-subject">
              <div>
                <p className="section-kicker">{result.device.device.id}</p>
                <h2>{result.device.device.hostname || result.device.device.id}</h2>
                <p>{`${result.device.rack?.id ?? "未知机柜"} / ${result.device.device.layer_id}`}</p>
              </div>
              <div className="intro-badges">
                <SourceBadge source={result.device.device.data_source} />
                <StatusBadge label="冗余未核实" tone="warning" />
              </div>
            </section>
            <section className="topology-columns">
              <PathPanel title="强电路径" nodes={result.device.power} tone="power" />
              <PathPanel title="网络路径" nodes={result.device.network} tone="network" />
            </section>
            <p className="redundancy-callout">图纸存在多条配电分支，但当前数据不足以证明设备级 A/B 冗余，本系统不作冗余承诺。</p>
          </div>
        ) : result.kind === "aggregate" && result.power && result.network ? (
          <div className="topology-results">
            <section className="topology-selection">
              <div>
                <p className="section-kicker">SELECTED TRACE</p>
                <strong>{result.query || "全部设计对象"}</strong>
                <span>{`命中 ${result.power.power_sources.length} 个电源、${result.power.cabinets.length} 个机柜、${result.network.access_switches.length} 台接入交换机`}</span>
              </div>
              <StatusBadge
                label={result.power.power_sources.length + result.power.cabinets.length + result.network.access_switches.length ? "关联对象已联动" : "未找到对象"}
                tone={result.power.power_sources.length + result.power.cabinets.length + result.network.access_switches.length ? "ok" : "warning"}
              />
            </section>
            <section className="topology-columns">
              <Panel title="强电对象" kicker="POWER OBJECTS">
                <div className="aggregate-map">
                  {result.power.power_sources.map((source) => (
                    <button key={source.id} type="button" className="aggregate-node power-source-node" onClick={() => { setQuery(source.id); loadTopology(source.id); }}>
                      <SourceBadge source={source.data_source} />
                      <strong>{source.id}</strong>
                      <span>{source.name}</span>
                      <code>{source.calculated_load_w === null ? "计算负载：未接入" : `图纸计算负载 ${(source.calculated_load_w / 1000).toFixed(0)} kW`}</code>
                    </button>
                  ))}
                  {result.power.cabinets.map((rack) => (
                    <button key={rack.id} type="button" className="aggregate-node" onClick={() => { setQuery(rack.id); loadTopology(rack.id); }}>
                      <strong>{rack.id}</strong>
                      <span>{`${rack.source_id} · ${(rack.design_power_w / 1000).toFixed(0)} kW`}</span>
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel title="弱电对象" kicker="NETWORK OBJECTS">
                <div className="aggregate-map">
                  <button type="button" className="aggregate-node core-node" onClick={() => { setQuery(result.network!.core.id); loadTopology(result.network!.core.id); }}>
                    <SourceBadge source={result.network.core.data_source} />
                    <strong>{result.network.core.id}</strong>
                    <span>{result.network.core.name}</span>
                  </button>
                  {result.network.access_switches.map((item) => (
                    <button key={item.id} type="button" className="aggregate-node network-node" onClick={() => { setQuery(item.id); loadTopology(item.id); }}>
                      <SourceBadge source={item.data_source} />
                      <strong>{item.id}</strong>
                      <span>{`${item.uplink} → ${item.connected_rack_ids.join(" / ")}`}</span>
                    </button>
                  ))}
                </div>
              </Panel>
            </section>
          </div>
        ) : <EmptyState title="输入对象开始查询" detail="默认示例 SRV-DEMO-10U 包含完整的 PDU 与交换机端口链路。" />
      ) : (
        <EmptyState title="输入对象开始查询" detail="默认示例 SRV-DEMO-10U 包含完整的 PDU 与交换机端口链路。" />
      )}
    </>
  );
}
