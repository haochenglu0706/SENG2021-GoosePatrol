import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./style/auth.module.css";

export default function RegisterPage() {
  const { sessionId, register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (sessionId) return <Navigate to="/app/despatch/view" replace />;

  const submit = async () => {
    setErr("");
    setLoading(true);
    try {
      await register(username, password, email);
      navigate("/login", { replace: true, state: { email, registered: true } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className="auth-panel">
        <div className="auth-panel-title">Create account</div>
        <div className="auth-panel-sub">Register a new client for GoosePatrol</div>
        {err ? <div className="alert alert-err">{err}</div> : null}
        <div className="field">
          <label htmlFor="reg-user">Username</label>
          <input
            id="reg-user"
            autoComplete="username"
            placeholder="your-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="reg-email">Email</label>
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="reg-pass">Password</label>
          <input
            id="reg-pass"
            type="password"
            autoComplete="new-password"
            placeholder="Min 8 chars, letter + digit"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p className={styles.hint}>Min 8 characters · at least one letter and one digit</p>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
          onClick={() => void submit()}
          disabled={loading || !username || !password || !email}
        >
          {loading ? <span className="spinner" /> : "Register →"}
        </button>
        <div className="auth-switch">
          Have an account? <Link to="/login">Sign in</Link>
        </div>
        <div className={styles.back}>
          <Link to="/">← Home</Link>
        </div>
      </div>
    </div>
  );
}
