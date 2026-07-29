import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { DeviceTopology, PowerTopology, NetworkTopology } from "../types/domain";

export interface TopologyResult {
  kind: "device" | "aggregate";
  query: string;
  device?: DeviceTopology;
  power?: PowerTopology;
  network?: NetworkTopology;
}

export const topologyResultAtom = atom<TopologyResult | null>(null);

let topologySerial = 0;

export const loadTopologyAction = atom(null, async (get, set, query: string) => {
  const serial = ++topologySerial;
  const normalized = query.trim();
  const isDevice = normalized.toUpperCase().startsWith("SRV-");

  let result: TopologyResult;
  if (isDevice) {
    const device = await api.topology.device(normalized);
    result = { kind: "device", query: normalized, device };
  } else {
    const [power, network] = await Promise.all([api.topology.power(), api.topology.network()]);
    result = { kind: "aggregate", query: normalized, power, network };
  }

  if (serial === topologySerial) {
    set(topologyResultAtom, result);
  }
  return result;
});
