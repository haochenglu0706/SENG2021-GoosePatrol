import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./routes/RequireAuth";
import HomePage from "./pages/home/HomePage";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import DespatchCreatePage from "./pages/despatch/create";
import DespatchViewPage from "./pages/despatch/view";
import DespatchStatusPage from "./pages/despatch/status";
import OrdersPage from "./pages/order/index";
import InvoicesPage from "./pages/invoices/index";
import ProfilePage from "./pages/profile/index";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Navigate to="despatch/view" replace />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="despatch/create" element={<DespatchCreatePage />} />
          <Route path="despatch/view" element={<DespatchViewPage />} />
          <Route path="despatch/status" element={<DespatchStatusPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
