import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { Room, Rack, Alarm, RuntimeConfig } from "../types/domain";

export const roomAtom = atom<Room | null>(null);
export const racksAtom = atom<Rack[]>([]);
export const alarmsAtom = atom<Alarm[]>([]);
export const configAtom = atom<RuntimeConfig | null>(null);

export const activeAlarmsAtom = atom((get) =>
  get(alarmsAtom).filter((a) => a.status !== "resolved"),
);

export const serverRacksAtom = atom((get) =>
  get(racksAtom).filter((r) => r.role === "server"),
);

export const refreshRoomAction = atom(null, async (get, set) => {
  set(getLoadingAtom(), true);
  set(getErrorAtom(), null);
  try {
    const [room, racks, alarms, config] = await Promise.all([
      api.room.get(),
      api.racks.list(),
      api.alarms.list(),
      api.config.status(),
    ]);
    set(roomAtom, room);
    set(racksAtom, racks.items);
    set(alarmsAtom, alarms.items);
    set(configAtom, config);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    set(getErrorAtom(), { code: e.code ?? "REQUEST_FAILED", message: e.message ?? "请求失败" });
  } finally {
    set(getLoadingAtom(), false);
  }
});

import { loadingAtom, errorAtom } from "./ui";
function getLoadingAtom() { return loadingAtom; }
function getErrorAtom() { return errorAtom; }
