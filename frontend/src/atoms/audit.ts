import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { AuditEntry } from "../types/domain";

export const auditAtom = atom<AuditEntry[]>([]);

export const loadAuditAction = atom(null, async (get, set) => {
  const result = await api.audit.list();
  set(auditAtom, result.items);
  return result.items;
});

export const resetDemoStateAction = atom(null, async (get, set) => {
  await api.demo.reset();
  set(auditAtom, []);
});
