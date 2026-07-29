interface SidebarProps {
  route: string;
  actor: string | null;
  role: string | null;
  authenticated: boolean;
  onNavigate: (route: string) => void;
  onLogout: () => void;
}

const navItems = [
  { view: "overview", label: "机房总览", code: "ROOM" },
  { view: "rack", label: "机柜与服务器", code: "RACK" },
  { view: "agent", label: "上架 Agent", code: "AGENT" },
  { view: "topology", label: "链路查询", code: "TRACE" },
  { view: "alarms", label: "报警诊断", code: "ALARM" },
  { view: "audit", label: "变更审计", code: "AUDIT" },
];

export function Sidebar({ route, actor, role, authenticated, onNavigate, onLogout }: SidebarProps) {
  const topLevelRoute = route === "rack" ? "overview" : route;
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <span className="brand-monogram">L5</span>
        <div>
          <strong>L5-A2-08</strong>
          <span>DATACENTER AGENT</span>
        </div>
      </div>
      <nav className="primary-nav">
        {navItems.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`nav-button ${topLevelRoute === item.view ? "is-active" : ""}`}
            data-view={item.view}
            onClick={() => onNavigate(item.view)}
          >
            <span>{item.code}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="session-summary">
          {authenticated ? (
            <>
              <strong>{actor}</strong>
              <span>{role === "admin" ? "管理员 · 可执行" : "只读查看者"}</span>
            </>
          ) : (
            <span>尚未登录</span>
          )}
        </div>
        <button
          type="button"
          className="secondary-button"
          style={{ marginTop: "10px", display: authenticated ? "block" : "none" }}
          onClick={onLogout}
        >
          退出登录
        </button>
      </div>
    </aside>
  );
}
