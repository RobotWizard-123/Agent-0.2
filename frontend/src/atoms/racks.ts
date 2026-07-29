import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { RackDetail, DeviceTopology } from "../types/domain";

export const selectedRackAtom = atom<RackDetail | null>(null);
export const selectedDeviceTopologyAtom = atom<DeviceTopology | null>(null);

export const loadRackAction = atom(null, async (get, set, rackId: string) => {
  const { loadingAtom, errorAtom } = await import("./ui");
  set(loadingAtom, true);
  set(selectedRackAtom, null);
  set(selectedDeviceTopologyAtom, null);
  try {
    const rack = await api.racks.detail(rackId);
    set(selectedRackAtom, rack);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    set(errorAtom, { code: e.code ?? "REQUEST_FAILED", message: e.message ?? "请求失败" });
  } finally {
    set(loadingAtom, false);
  }
});

export const loadDeviceTopologyAction = atom(null, async (get, set, deviceId: string) => {
  try {
    const topology = await api.topology.device(deviceId);
    set(selectedDeviceTopologyAtom, topology);
  } catch (error) {
    const { errorAtom } = await import("./ui");
    const e = error as { code?: string; message?: string };
    set(errorAtom, { code: e.code ?? "REQUEST_FAILED", message: e.message ?? "请求失败" });
  }
});
