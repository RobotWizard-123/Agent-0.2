import { atom } from "jotai";
import type { Route, Toast, ToastTone, DialogContent } from "../types/common";

export const routeAtom = atom<Route>({ name: "overview", id: null });

export const loadingAtom = atom<boolean>(true);

export const errorAtom = atom<{ code: string; message: string } | null>(null);

export const toastAtom = atom<Toast[]>([]);

export const dialogAtom = atom<DialogContent>(null);

export const showToastAction = atom(null, (get, set, { message, tone = "ok" }: { message: string; tone?: ToastTone }) => {
  const id = crypto.randomUUID();
  set(toastAtom, [...get(toastAtom), { id, message, tone }]);
  setTimeout(() => {
    set(toastAtom, (prev) => prev.filter((t) => t.id !== id));
  }, 3200);
});

export const setRouteAction = atom(null, (get, set, route: Route) => {
  set(routeAtom, route);
  set(errorAtom, null);
});

export const openDialogAction = atom(null, (get, set, content: DialogContent) => {
  set(dialogAtom, content);
});

export const closeDialogAction = atom(null, (get, set) => {
  set(dialogAtom, null);
});
