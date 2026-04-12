import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const NAV = [
  { to: "/app/orders", id: "orders", label: "Orders", icon: "📋" },
  { to: "/app/despatch/view", id: "despatch", label: "Despatch", icon: "📦" },
  { to: "/app/receipt-advices/view", id: "receipts", label: "Receipts", icon: "🧾" },
  { to: "/app/invoices", id: "invoices", label: "Invoices", icon: "🧾" },
  { to: "/app/profile", id: "profile", label: "Profile", icon: "👤" },
];

export function Sidebar() {
  const { pathname } = useLocation();
  const { sessionId, username, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-row">
          <div className="sidebar-logo-icon">📦</div>
          <span className="sidebar-logo-name">GoosePatrol</span>
        </div>
        <span className="sidebar-logo-tag">SaaS</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-label">Navigation</div>
        {NAV.map((p) => (
          <NavLink
            key={p.id}
            to={p.to}
            className={({ isActive }) => {
              const despatchActive =
                p.id === "despatch" && pathname.startsWith("/app/despatch");
              return `nav-item${isActive || despatchActive ? " active" : ""}`;
            }}
            end={p.id !== "despatch"}
          >
            <span className="nav-icon">{p.icon}</span>
            <span>{p.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="session-badge">
          ✓ {username || "Authenticated"}
          <br />
          <span style={{ fontSize: 9, opacity: 0.7 }}>
            {sessionId ? `${sessionId.slice(0, 24)}…` : ""}
          </span>
        </div>
        <button type="button" className="logout-btn" onClick={() => void logout()}>
          ↩ <span>Log Out</span>
        </button>
      </div>
    </aside>
  );
}
