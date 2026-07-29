import { createDemoOccupancy } from "./demo-occupancy.js";

const SERVER_RACK_COUNT = 20;

function rackId(number) {
  return `CAB-${String(number).padStart(2, "0")}`;
}

function powerForRack(number) {
  if (number <= 8) {
    return { source_id: "JG1", design_power_w: 10_000, breaker: "C40/2P", cable: "3×10" };
  }
  if (number <= 10) {
    return { source_id: "JG1", design_power_w: 20_000, breaker: "C63/2P", cable: "3×16" };
  }
  if (number <= 13) {
    return { source_id: "JG2", design_power_w: 20_000, breaker: "C63/2P", cable: "3×16" };
  }
  return { source_id: "JG2", design_power_w: 10_000, breaker: "C40/2P", cable: "3×10" };
}

function floorPosition(number) {
  return number <= 11
    ? { row: 1, column: number, data_source: "demo" }
    : { row: 2, column: 23 - number, data_source: "demo" };
}

function serverRack(number) {
  const id = rackId(number);
  return {
    id,
    name: `服务器机柜 ${String(number).padStart(2, "0")}`,
    role: "server",
    height_u: 42,
    dividers_u: [12, 22, 32],
    reserve_u_per_layer: 2,
    max_weight_kg: 420,
    network_port_limit: 24,
    network_switch_id: `ASW-${String(Math.ceil(number / 2)).padStart(2, "0")}`,
    pdu_ids: [`${id}-PDU`],
    floor_position: floorPosition(number),
    data_source: "design",
    ...powerForRack(number),
  };
}

function networkRack(number, alias) {
  const id = rackId(number);
  return {
    id,
    alias,
    name: `网络机柜 ${String(number).padStart(2, "0")}`,
    role: "network",
    height_u: 42,
    dividers_u: [12, 22, 32],
    reserve_u_per_layer: 2,
    max_weight_kg: 420,
    network_port_limit: 48,
    source_id: "KT1",
    design_power_w: 5_000,
    breaker: "C40/2P",
    cable: "3×10",
    pdu_ids: [`${id}-PDU`],
    floor_position: floorPosition(number),
    data_source: "design",
  };
}

function accessSwitches() {
  return Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    const firstRack = number * 2 - 1;
    return {
      id: `ASW-${String(number).padStart(2, "0")}`,
      name: `接入交换机 ${String(number).padStart(2, "0")}`,
      uplink: "10Gx2",
      downlink: "1Gx48",
      downlink_ports: 48,
      connected_rack_ids: [rackId(firstRack), rackId(firstRack + 1)],
      data_source: "design",
    };
  });
}

export function createDemoState() {
  const racks = [
    ...Array.from({ length: SERVER_RACK_COUNT }, (_, index) => serverRack(index + 1)),
    networkRack(21, "NET-01"),
    networkRack(22, "NET-02"),
  ];
  const occupancy = createDemoOccupancy(racks);
  const state = {
    version: 1,
    room: {
      id: "L5-A2-08",
      name: "L5-A2-08 机房",
      rack_count: 22,
      server_rack_count: 20,
      network_rack_count: 2,
      data_source: "design",
    },
    power_sources: [
      {
        id: "JG1",
        name: "服务器机柜配电 JG1",
        calculated_load_w: 96_000,
        rack_ids: Array.from({ length: 10 }, (_, index) => rackId(index + 1)),
        data_source: "design",
      },
      {
        id: "JG2",
        name: "服务器机柜配电 JG2",
        calculated_load_w: 104_000,
        rack_ids: Array.from({ length: 10 }, (_, index) => rackId(index + 11)),
        data_source: "design",
      },
      {
        id: "KT1",
        name: "网络机柜配电 KT1",
        calculated_load_w: null,
        rack_ids: ["CAB-21", "CAB-22"],
        data_source: "unknown",
      },
    ],
    racks,
    devices: occupancy.devices,
    power_connections: occupancy.power_connections,
    network_connections: occupancy.network_connections,
    topology: {
      network: {
        external_uplink: { label: "10G光纤接入", data_source: "design" },
        core: { id: "CORE-01", name: "核心交换机", uplink: "10G", ports: 48, data_source: "design" },
        access_switches: accessSwitches(),
      },
      redundancy: { status: "unverified", data_source: "unknown" },
    },
    plans: [],
    alarms: [],
    diagnoses: [],
    changes: [],
    audit: [],
    demo_conditions: [],
    settings: {
      placement: { default_strategy_id: "balanced_optimal" },
    },
    service_health: {
      model: { status: "unknown", checked_at: null },
      collector: { status: "not_connected", checked_at: null },
    },
  };

  return structuredClone(state);
}
