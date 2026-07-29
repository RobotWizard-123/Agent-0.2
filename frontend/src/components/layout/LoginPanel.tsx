import { useState, type FormEvent } from "react";

interface LoginPanelProps {
  hidden: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
}

export function LoginPanel({ hidden, onLogin }: LoginPanelProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onLogin(username, password);
      setUsername("");
      setPassword("");
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      setError(e.status === 401 ? "用户名或密码错误" : `${e.code ?? "LOGIN_FAILED"} · ${e.message ?? "请求失败"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-panel ${hidden ? "is-hidden" : ""}`}>
      <form className="login-card" onSubmit={handleSubmit}>
        <h2>控制台登录</h2>
        <p className="login-copy">
          L5-A2-08 机房智能管理 Agent。管理员可执行上架、确认和重置；只读查看者可浏览全部数据。
        </p>
        <div className="login-schematic">
          <span>JG1</span>
          <i />
          <b>L5-A2-08</b>
          <i />
          <span>JG2</span>
        </div>
        <label className="form-field">
          用户名
          <input
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
        </label>
        <label className="form-field">
          密码
          <input
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <p className="form-error">{error}</p>
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? "正在登录…" : "登录控制台"}
        </button>
      </form>
    </div>
  );
}
