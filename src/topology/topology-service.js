function topologyError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function node(type, id, label, source, details = {}) {
  return { type, id, label, source, details };
}

export function createTopologyService() {
  return {
    devicePath(state, deviceId) {
      const device = state.devices.find((item) => item.id === deviceId);
      if (!device) throw topologyError("DEVICE_NOT_FOUND", `Device does not exist: ${deviceId}`, { device_id: deviceId });
      const rack = state.racks.find((item) => item.id === device.rack_id);
      if (!rack) throw topologyError("RACK_NOT_FOUND", `Rack does not exist: ${device.rack_id}`, { rack_id: device.rack_id });

      const powerSource = state.power_sources.find((item) => item.id === rack.source_id);
      const powerConnection = state.power_connections.find((item) => item.device_id === deviceId);
      const networkConnection = state.network_connections.find((item) => item.device_id === deviceId);
      const accessSwitch = networkConnection
        ? state.topology.network.access_switches.find((item) => item.id === networkConnection.switch_id)
        : null;
      const missingFields = [];

      const power = [
        node("room", state.room.id, state.room.name, state.room.data_source),
        node("power_source", powerSource?.id ?? null, powerSource?.name ?? "配电来源未接入", powerSource?.data_source ?? "unknown", {
          calculated_load_w: powerSource?.calculated_load_w ?? null,
        }),
        node("rack", rack.id, rack.name, rack.data_source, { design_power_w: rack.design_power_w }),
      ];
      if (powerConnection) {
        power.push(node("pdu", powerConnection.pdu_id, `${powerConnection.pdu_id} / ${powerConnection.outlet}`, powerConnection.data_source, {
          outlet: powerConnection.outlet,
        }));
        power.push(node("device", device.id, device.hostname ?? device.id, device.data_source));
      } else {
        missingFields.push("power_connection");
        power.push(node("power_connection", null, "设备PDU插口未接入", "unknown"));
      }

      const network = [node("device", device.id, device.hostname ?? device.id, device.data_source)];
      if (networkConnection) {
        network.push(node("access_switch", accessSwitch?.id ?? networkConnection.switch_id, accessSwitch?.name ?? networkConnection.switch_id, networkConnection.data_source, {
          device_port: networkConnection.device_port,
          switch_port: networkConnection.switch_port,
          vlan: networkConnection.vlan,
        }));
        network.push(node("core_switch", state.topology.network.core.id, state.topology.network.core.name, state.topology.network.core.data_source));
        network.push(node("external_uplink", null, state.topology.network.external_uplink.label, state.topology.network.external_uplink.data_source));
      } else {
        missingFields.push("network_connection");
        network.push(node("network_connection", null, "交换机端口未接入", "unknown"));
      }

      return {
        device: structuredClone(device),
        rack: structuredClone(rack),
        power,
        network,
        redundancy: "unverified",
        missing_fields: missingFields,
      };
    },
  };
}
