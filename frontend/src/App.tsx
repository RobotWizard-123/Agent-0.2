import { useEffect, useRef, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { AppShell } from "./components/layout/AppShell";
import { StatusStrip } from "./components/layout/StatusStrip";
import { LoginPanel } from "./components/layout/LoginPanel";
import { Dialog, Toast, LoadingState, EmptyState } from "./components/ui";
import { AssistantPanel } from "./components/assistant/AssistantPanel";
import { OverviewView } from "./views/OverviewView";
import { RackDetailView } from "./views/RackDetailView";
import { AgentConsoleView } from "./views/AgentConsoleView";
import { TopologyView } from "./views/TopologyView";
import { AlarmsView } from "./views/AlarmsView";
import { AuditView } from "./views/AuditView";
import { sessionAtom, isAuthenticatedAtom, bootstrapAuthAction, loginAction, logoutAction } from "./atoms/auth";
import { routeAtom, loadingAtom, errorAtom, toastAtom, dialogAtom, setRouteAction, closeDialogAction, showToastAction } from "./atoms/ui";
import { roomAtom, racksAtom, alarmsAtom, configAtom, refreshRoomAction } from "./atoms/room";
import { loadRackAction } from "./atoms/racks";
import { loadAuditAction, resetDemoStateAction } from "./atoms/audit";
import { loadTopologyAction } from "./atoms/topology";
import { agentStatusAtom, refreshAgentStatusAction } from "./atoms/agent-status";
import { loadPlacementSettingsAction } from "./atoms/settings";
import { initAssistantAction, pollAssistantFeedbackAction, clearAssistantAction } from "./atoms/assistant";

const titles: Record<string, string> = {
  overview: "机房总览",
  rack: "机柜与服务器",
  agent: "上架 Agent",
  topology: "链路查询",
  alarms: "报警诊断",
  audit: "变更审计",
};

export default function App() {
  const session = useAtomValue(sessionAtom);
  const authenticated = useAtomValue(isAuthenticatedAtom);
  const route = useAtomValue(routeAtom);
  const loading = useAtomValue(loadingAtom);
  const error = useAtomValue(errorAtom);
  const toasts = useAtomValue(toastAtom);
  const dialog = useAtomValue(dialogAtom);
  const room = useAtomValue(roomAtom);
  const racks = useAtomValue(racksAtom);
  const alarms = useAtomValue(alarmsAtom);
  const config = useAtomValue(configAtom);
  const agentStatus = useAtomValue(agentStatusAtom);

  const bootstrapAuth = useSetAtom(bootstrapAuthAction);
  const login = useSetAtom(loginAction);
  const logout = useSetAtom(logoutAction);
  const refreshRoom = useSetAtom(refreshRoomAction);
  const setRoute = useSetAtom(setRouteAction);
  const closeDialog = useSetAtom(closeDialogAction);
  const loadRack = useSetAtom(loadRackAction);
  const loadAudit = useSetAtom(loadAuditAction);
  const loadTopology = useSetAtom(loadTopologyAction);
  const refreshAgentStatus = useSetAtom(refreshAgentStatusAction);
  const loadPlacementSettings = useSetAtom(loadPlacementSettingsAction);
  const initAssistant = useSetAtom(initAssistantAction);
  const pollAssistantFeedback = useSetAtom(pollAssistantFeedbackAction);
  const clearAssistant = useSetAtom(clearAssistantAction);
  const resetDemoState = useSetAtom(resetDemoStateAction);

  const bootedRef = useRef(false);
  const auditLoadedRef = useRef(false);
  const topologyLoadedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    bootstrapAuth().then(() => {
      refreshRoom();
      loadPlacementSettings();
    });
  }, [bootstrapAuth, refreshRoom, loadPlacementSettings]);

  useEffect(() => {
    if (authenticated) refreshRoom();
  }, [authenticated, refreshRoom]);

  useEffect(() => {
    refreshAgentStatus(true);
    const timer = setInterval(() => refreshAgentStatus(), 15_000);
    return () => clearInterval(timer);
  }, [refreshAgentStatus]);

  const assistantKey = `${session.authenticated}:${session.actor ?? ""}:${session.role ?? ""}`;
  const prevAssistantKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevAssistantKeyRef.current === assistantKey) return;
    prevAssistantKeyRef.current = assistantKey;
    if (session.authenticated) {
      initAssistant(assistantKey);
    } else {
      clearAssistant();
    }
  }, [assistantKey, session.authenticated, initAssistant, clearAssistant]);

  useEffect(() => {
    if (!session.authenticated) return;
    const timer = setInterval(() => {
      pollAssistantFeedback({ route: route.name, entityId: route.id });
    }, 30_000);
    return () => clearInterval(timer);
  }, [session.authenticated, route.name, route.id, pollAssistantFeedback]);

  useEffect(() => {
    if (route.name === "rack" && route.id) {
      loadRack(route.id);
    }
  }, [route.name, route.id, loadRack]);

  useEffect(() => {
    if (route.name === "audit" && !auditLoadedRef.current) {
      auditLoadedRef.current = true;
      loadAudit();
    }
  }, [route.name, loadAudit]);

  useEffect(() => {
    if (route.name === "topology" && !topologyLoadedRef.current) {
      topologyLoadedRef.current = true;
      loadTopology(route.id || "SRV-DEMO-10U");
    }
  }, [route.name, route.id, loadTopology]);

  const handleLogin = async (username: string, password: string) => {
    await login({ username, password });
    await refreshRoom();
  };

  const handleLogout = async () => {
    await logout();
  };

  const handleResetDemo = async () => {
    await resetDemoState();
    await refreshRoom();
    await loadAudit();
  };

  const activeAlarms = alarms.filter((a) => a.status !== "resolved");

  let viewContent: ReactNode;
  if (loading) {
    viewContent = <LoadingState />;
  } else if (error) {
    viewContent = <EmptyState title="数据读取失败" detail={`${error.code} · ${error.message}`} />;
  } else {
    switch (route.name) {
      case "overview":
        viewContent = <OverviewView />;
        break;
      case "rack":
        viewContent = <RackDetailView />;
        break;
      case "agent":
        viewContent = <AgentConsoleView />;
        break;
      case "topology":
        viewContent = <TopologyView />;
        break;
      case "alarms":
        viewContent = <AlarmsView />;
        break;
      case "audit":
        viewContent = <AuditView />;
        break;
      default:
        viewContent = <EmptyState title="未知界面" detail="请从左侧导航选择功能。" />;
    }
  }

  return (
    <>
      <LoginPanel hidden={session.authenticated} onLogin={handleLogin} />
      <AppShell
        authenticated={session.authenticated}
        route={route.name}
        actor={session.actor}
        role={session.role}
        onNavigate={(r) => setRoute({ name: r as typeof route.name, id: null })}
        onLogout={handleLogout}
      >
        <header className="command-header">
          <div>
            <h1>{titles[route.name] ?? "机房智能管理"}</h1>
          </div>
          <StatusStrip
            stateVersion={room?.state_version ?? null}
            alarmCount={activeAlarms.length}
            hasAlarms={activeAlarms.length > 0}
            agentStatus={agentStatus}
            agentConfigured={config?.agent_configured ?? false}
            agentModel={config?.agent_model ?? null}
          />
        </header>
        <div className="workspace">{viewContent}</div>
      </AppShell>
      {session.authenticated ? <AssistantPanel /> : null}
      {dialog ? <Dialog onClose={closeDialog}>{dialog}</Dialog> : null}
      <Toast toasts={toasts} />
    </>
  );
}
