import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAuth() {
  const { sessionId } = useAuth();
  const location = useLocation();
  if (!sessionId) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
