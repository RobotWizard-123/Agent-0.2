import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { deriveLayers, freeIntervals, packDevices } from "../src/domain/rack-layout.js";

test("derives four layers and reserves 2U once per layer", () => {
  const rack = createDemoState().racks[0];
  const layers = deriveLayers(rack);

  assert.deepEqual(
    layers.map((layer) => [layer.id, layer.start_u, layer.end_u, layer.capacity_u, layer.usable_u]),
    [
      ["L01", 1, 12, 12, 10],
      ["L02", 13, 22, 10, 8],
      ["L03", 23, 32, 10, 8],
      ["L04", 33, 42, 10, 8],
    ],
  );
});

test("rejects divider layouts that move the fixed U12 divider", () => {
  const rack = { ...createDemoState().racks[0], dividers_u: [11, 22, 32] };

  assert.throws(
    () => deriveLayers(rack),
    (error) => error.code === "DIVIDER_LAYOUT_INVALID",
  );
});

test("fixed placements preserve physical holes instead of compacting devices", () => {
  const rack = createDemoState().racks[0];
  const packed = packDevices(rack, [
    { id: "LOW", layer_id: "L02", start_u: 13, u_size: 2 },
    { id: "HIGH", layer_id: "L02", start_u: 18, u_size: 2 },
  ]);

  assert.deepEqual(
    packed.map((placement) => [placement.device_id, placement.start_u, placement.end_u]),
    [
      ["LOW", 13, 14],
      ["HIGH", 18, 19],
    ],
  );
});

test("free intervals exclude occupied and reserved U positions", () => {
  const rack = createDemoState().racks[0];
  const devices = [
    { id: "LOW", layer_id: "L02", start_u: 13, u_size: 2 },
    { id: "HIGH", layer_id: "L02", start_u: 18, u_size: 2 },
  ];
  assert.deepEqual(freeIntervals(rack, devices).filter((item) => item.layer_id === "L02"), [
    { rack_id: rack.id, layer_id: "L02", start_u: 15, end_u: 17, size_u: 3 },
    { rack_id: rack.id, layer_id: "L02", start_u: 20, end_u: 20, size_u: 1 },
  ]);
});

test("rejects the single reserved interval at the top of a layer", () => {
  const rack = createDemoState().racks[0];
  assert.throws(() => packDevices(rack, [
    { id: "RESERVED", layer_id: "L02", start_u: 20, u_size: 2 },
  ]), (error) => error.code === "LAYER_RESERVE_OCCUPIED");
});

test("canonical near-full rack exposes fragmented rather than aggregate-only space", () => {
  const state = createDemoState();
  const rack = state.racks.find((item) => item.id === "CAB-18");
  const intervals = freeIntervals(rack, state.devices.filter((device) => device.rack_id === rack.id));
  assert.equal(intervals.reduce((sum, item) => sum + item.size_u, 0), 4);
  assert.equal(Math.max(...intervals.map((item) => item.size_u)), 2);
});

test("allows two 4U devices in an 8U usable layer and rejects a third", () => {
  const rack = createDemoState().racks[0];
  const twoDevices = [
    { id: "FOUR-A", layer_id: "L02", start_u: 13, u_size: 4 },
    { id: "FOUR-B", layer_id: "L02", start_u: 17, u_size: 4 },
  ];

  assert.equal(packDevices(rack, twoDevices).length, 2);
  assert.throws(() => packDevices(rack, [
    ...twoDevices,
    { id: "FOUR-C", layer_id: "L02", start_u: 13, u_size: 4 },
  ]), (error) => error.code === "DEVICE_U_OVERLAP" && error.layer_id === "L02");
});
