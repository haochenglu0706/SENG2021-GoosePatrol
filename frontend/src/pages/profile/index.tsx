import { TopBar } from "../../components/layout/TopBar";
import { useAuth } from "../../context/AuthContext";
import styles from "./style/profile.module.css";

export default function ProfilePage() {
  const { clientId, username, email, sessionId, logout } = useAuth();

  return (
    <>
      <TopBar title="Profile" subtitle="Your account" />
      <div className={`page-body ${styles.page}`}>
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="profile-avatar">🦢</div>
          <div className="profile-name">{username || "Client"}</div>
          <div className="profile-id">Client ID: {clientId}</div>
          {email ? (
            <p className={styles.email}>
              <span className={styles.muted}>Email</span> {email}
            </p>
          ) : null}

          <div className="section-label">Session</div>
          <p className={styles.session}>
            <span className={styles.muted}>Session ID</span> {sessionId}
          </p>

          <div className="section-label">Account</div>
          <p className={styles.note}>
            You are signed in. Your session stays active in this browser until you log out or the
            session is revoked on the server.
          </p>

          <div style={{ marginTop: 20 }}>
            <button type="button" className="btn btn-danger" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
