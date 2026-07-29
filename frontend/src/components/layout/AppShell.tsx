import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  authenticated: boolean;
  route: string;
  actor: string | null;
  role: string | null;
  onNavigate: (route: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export function AppShell({ authenticated, route, actor, role, onNavigate, onLogout, children }: AppShellProps) {
  return (
    <div className={`app-shell ${authenticated ? "" : "is-locked"}`}>
      <Sidebar
        route={route}
        actor={actor}
        role={role}
        authenticated={authenticated}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />
      <main className="main-stage">{children}</main>
    </div>
  );
}
