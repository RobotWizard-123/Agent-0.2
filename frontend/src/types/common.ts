export type RouteName = "overview" | "rack" | "agent" | "topology" | "alarms" | "audit";

export interface Route {
  name: RouteName;
  id: string | null;
}

export type ToastTone = "ok" | "warning" | "danger";

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

export type DialogContent = React.ReactNode | null;

export interface RackRisk {
  tone: "normal" | "warning" | "blocker";
  basis: string;
  ratio: number;
  power_ratio: number;
  u_ratio: number;
}
