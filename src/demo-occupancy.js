const USED_U_BY_RACK = [2, 4, 16, 18, 20, 22, 24, 26, 28, 26, 22, 20, 18, 16, 22, 24, 26, 30, 20, 20];
const POWER_TOTALS = new Map([
  ["CAB-08", 7_900],
  ["CAB-10", 15_800],
]);
const DEVICE_SIZES = [4, 2, 6, 8, 10, 2, 4, 6];
const BUSINESSES = ["ai-platform", "compute-platform", "storage-platform", "database-platform"];
const ANCHORS = {
  "CAB-09": {
    id: "SRV-DEMO-10U",
    asset_id: "ASSET-1001",
    hostname: "gpu-demo-01",
    model: "10U GPU Demo",
    serial: "DEMO-SN-1001",
    u_size: 10,
    business_id: "ai-platform",
    owner: "datacenter-ops",
  },
  "CAB-11": {
    id: "SRV-DEMO-4U",
    asset_id: "ASSET-1002",
    hostname: "compute-demo-01",
    model: "4U Compute Demo",
    serial: "DEMO-SN-1002",
    u_size: 4,
    business_id: "compute-platform",
    owner: "platform-ops",
  },
  "CAB-14": {
    id: "SRV-DEMO-2U",
    asset_id: "ASSET-1003",
    hostname: "storage-demo-01",
    model: "2U Storage Demo",
    serial: "DEMO-SN-1003",
    u_size: 2,
    business_id: "storage-platform",
    owner: "storage-ops",
  },
};

function demoDeviceColor(id) {
  let hash = 0;
  for (const char of String(id)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function usableIntervals(rack) {
  const ends = rack.dividers_u;
  return [
    [1, ends[0] - 2],
    [ends[0] + 1, ends[1] - 2],
    [ends[1] + 1, ends[2] - 2],
    [ends[2] + 1, rack.height_u - 2],
  ];
}

function profileDevices(rack, rackIndex, targetU) {
  const devices = [];
  let remaining = targetU;
  let sizeIndex = rackIndex % DEVICE_SIZES.length;

  for (const [layerIndex, [start, end]] of usableIntervals(rack).entries()) {
    // Keep one real 10U expansion bay without weakening the L01-only rule.
    if (rack.id === "CAB-01" && layerIndex === 0) continue;
    let cursor = start;
    while (remaining > 0 && cursor <= end) {
      const capacity = end - cursor + 1;
      const anchor = devices.length === 0 ? ANCHORS[rack.id] : null;
      const preferred = anchor?.u_size ?? DEVICE_SIZES[sizeIndex % DEVICE_SIZES.length];
      const size = Math.min(preferred, capacity, remaining, 10);
      if (size <= 0) break;

      const ordinal = devices.length + 1;
      const criticality = ordinal % 7 === 0
        ? "critical"
        : ordinal % 3 === 0 ? "important" : "normal";
      const movable = criticality === "normal" && ordinal % 2 === 0;
      const businessId = anchor?.business_id ?? BUSINESSES[(rackIndex + ordinal) % BUSINESSES.length];
      const id = anchor?.id ?? `SRV-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`;

      devices.push({
        id,
        asset_id: anchor?.asset_id ?? `ASSET-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`,
        hostname: anchor?.hostname ?? `node-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`,
        model: anchor?.model ?? `${size}U Demo Server`,
        serial: anchor?.serial ?? `SIM-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`,
        rack_id: rack.id,
        layer_id: `L0${layerIndex + 1}`,
        start_u: cursor,
        u_size: size,
        rated_power_w: 0,
        real_power_w: null,
        weight_kg: size * 8,
        network_ports: size >= 8 ? 4 : 2,
        ip: `10.0.${rackIndex + 1}.${10 + ordinal}`,
        vlan: `VLAN-${101 + rackIndex}`,
        business_id: businessId,
        business: businessId,
        owner: anchor?.owner ?? `${businessId}-ops`,
        replica_group: null,
        movable,
        criticality,
        maintenance_window: movable ? "Saturday 02:00-04:00" : null,
        status: "running",
        data_source: "demo",
        color: demoDeviceColor(id),
      });
      cursor += size;
      remaining -= size;
      sizeIndex += 1;
    }
  }

  if (remaining !== 0) throw new Error(`Occupancy profile does not fit ${rack.id}`);
  return devices;
}

function assignPower(devices, targetW) {
  const totalU = devices.reduce((sum, device) => sum + device.u_size, 0);
  let assigned = 0;
  return devices.map((device, index) => {
    const power = index === devices.length - 1
      ? targetW - assigned
      : Math.max(100, Math.floor((targetW * device.u_size) / totalU / 10) * 10);
    assigned += power;
    return { ...device, rated_power_w: power };
  });
}

function uniqueByDevice(items) {
  return [...new Map(items.map((item) => [item.device_id, item])).values()];
}

export function createDemoOccupancy(racks) {
  const serverRacks = racks.filter((rack) => rack.role === "server");
  const devices = serverRacks.flatMap((rack, index) => {
    const targetPower = POWER_TOTALS.get(rack.id) ?? Math.min(
      Math.floor(rack.design_power_w * (0.22 + USED_U_BY_RACK[index] / 100)),
      Math.floor(rack.design_power_w * 0.72),
    );
    const rackDevices = profileDevices(rack, index, USED_U_BY_RACK[index]);
    if (rack.id === "CAB-18") {
      const fragmented = rackDevices.find((device) => device.layer_id === "L04" && device.u_size === 4);
      if (!fragmented) throw new Error("CAB-18 fragmentation fixture is invalid");
      fragmented.start_u = 35;
    }
    return assignPower(rackDevices, targetPower);
  });

  const replicas = [
    devices.find((device) => device.rack_id === "CAB-03"),
    devices.find((device) => device.rack_id === "CAB-14"),
  ];
  replicas.forEach((device) => {
    device.replica_group = "RG-DEMO-01";
    device.business_id = "database-platform";
    device.business = "database-platform";
  });

  const powerConnections = devices.filter((_, index) => index % 4 !== 0).map((device, index) => ({
    device_id: device.id,
    source_id: racks.find((rack) => rack.id === device.rack_id).source_id,
    rack_id: device.rack_id,
    pdu_id: `${device.rack_id}-PDU`,
    outlet: `P${String((index % 24) + 1).padStart(2, "0")}`,
    data_source: "demo",
  }));
  const networkConnections = devices.filter((_, index) => index % 5 !== 0).map((device, index) => ({
    device_id: device.id,
    device_port: "eth0",
    switch_id: racks.find((rack) => rack.id === device.rack_id).network_switch_id,
    switch_port: `GE0/0/${String((index % 48) + 1).padStart(2, "0")}`,
    vlan: `VLAN-${100 + (index % 20)}`,
    data_source: "demo",
  }));

  powerConnections.push(
    { device_id: "SRV-DEMO-10U", source_id: "JG1", rack_id: "CAB-09", pdu_id: "CAB-09-PDU", outlet: "P01", data_source: "demo" },
    { device_id: "SRV-DEMO-4U", source_id: "JG2", rack_id: "CAB-11", pdu_id: "CAB-11-PDU", outlet: "P03", data_source: "demo" },
  );
  networkConnections.push(
    { device_id: "SRV-DEMO-10U", device_port: "eth0", switch_id: "ASW-05", switch_port: "GE0/0/01", vlan: "VLAN-109", data_source: "demo" },
    { device_id: "SRV-DEMO-4U", device_port: "eth0", switch_id: "ASW-06", switch_port: "GE0/0/01", vlan: "VLAN-111", data_source: "demo" },
  );

  return {
    devices,
    power_connections: uniqueByDevice(powerConnections),
    network_connections: uniqueByDevice(networkConnections),
  };
}
