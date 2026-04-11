import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./style/auth.module.css";

export default function LoginPage() {
  const { sessionId, login } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/app/despatch/view";
  const registered = Boolean((location.state as { registered?: boolean } | null)?.registered);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? "");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (sessionId) return <Navigate to={from} replace />;

  const submit = async () => {
    setErr("");
    setLoading(true);
    try {
      await login(username, password, email);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className="auth-panel">
        <div className="auth-panel-title">Welcome back</div>
        <div className="auth-panel-sub">Sign in to your GoosePatrol account</div>
        {registered ? (
          <div className="alert alert-ok">Account created. Sign in with your new credentials.</div>
        ) : null}
        {err ? <div className="alert alert-err">{err}</div> : null}
        <div className="field">
          <label htmlFor="login-user">Username</label>
          <input
            id="login-user"
            autoComplete="username"
            placeholder="your-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>
        <div className="field">
          <label htmlFor="login-pass">Password</label>
          <input
            id="login-pass"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
          onClick={() => void submit()}
          disabled={loading || !username || !password || !email}
        >
          {loading ? <span className="spinner" /> : "Sign in →"}
        </button>
        <div className="auth-switch">
          No account? <Link to="/register">Register a new client</Link>
        </div>
        <div className={styles.back}>
          <Link to="/">← Home</Link>
        </div>
      </div>
    </div>
  );
}
