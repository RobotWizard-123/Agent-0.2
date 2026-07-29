import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { Session } from "../types/domain";

export const sessionAtom = atom<Session>({
  authenticated: false,
  actor: null,
  role: null,
});

export const isAuthenticatedAtom = atom((get) => get(sessionAtom).authenticated);

export const isAdminAtom = atom((get) => get(sessionAtom).role === "admin");

export const bootstrapAuthAction = atom(null, async (get, set) => {
  try {
    const session = await api.auth.session();
    set(sessionAtom, session);
  } catch {
    set(sessionAtom, { authenticated: false, actor: null, role: null });
  }
});

export const loginAction = atom(null, async (get, set, { username, password }: { username: string; password: string }) => {
  const result = await api.auth.login({ username, password });
  const session: Session = {
    authenticated: result.authenticated,
    actor: result.actor,
    role: result.role as "admin" | "viewer",
  };
  set(sessionAtom, session);
});

export const logoutAction = atom(null, async (get, set) => {
  await api.auth.logout();
  set(sessionAtom, { authenticated: false, actor: null, role: null });
});
