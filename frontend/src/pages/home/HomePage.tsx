import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./style/home.module.css";

export default function HomePage() {
  const { sessionId } = useAuth();
  if (sessionId) return <Navigate to="/app/despatch/view" replace />;

  return (
    <div className="landing-root">
      <nav className="landing-nav">
        <div className="landing-nav-logo">
          <div className="sidebar-logo-icon">📦</div>
          GoosePatrol
        </div>
        <div className="landing-nav-actions">
          <Link to="/login" className="btn btn-secondary" style={{ textDecoration: "none" }}>
            Sign in
          </Link>
          <Link to="/register" className="btn btn-primary" style={{ textDecoration: "none" }}>
            Get started
          </Link>
        </div>
      </nav>

      <div className="landing-hero">
        <div className="hero-glow" />
        <div className="hero-label">🦢 Delivery document exchange — SaaS</div>
        <h1 className="hero-title">
          The smarter way to run <span className="hero-accent">despatch &amp; delivery</span>
        </h1>
        <p className="hero-sub">
          GoosePatrol is a cloud platform for UBL-compliant despatch advices, receipt confirmations,
          and order workflows — built for teams that need traceable hand-offs between suppliers and
          customers.
        </p>
        <div className="hero-actions">
          <Link to="/register" className={styles.heroPrimary}>
            Start for free
          </Link>
          <Link to="/login" className={styles.heroSecondary}>
            Sign in
          </Link>
        </div>
      </div>

      <div className="features-row">
        {[
          {
            icon: "📋",
            title: "Order & delivery management",
            desc: "Track despatch documents end-to-end with clear parties, shipment details, and line items aligned to UBL 2.1.",
          },
          {
            icon: "📦",
            title: "Despatch system",
            desc: "Issue despatch advices, monitor status from draft to received or cancelled, and export XML for downstream systems.",
          },
          {
            icon: "🔗",
            title: "SaaS-ready workflow",
            desc: "Register clients, persist sessions securely, and work from a focused dashboard with role-aware views.",
          },
        ].map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <div className="feature-title">{f.title}</div>
            <div className="feature-desc">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
