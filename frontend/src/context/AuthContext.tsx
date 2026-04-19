import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, API_BASE } from "../api/client";

const LS_SESSION = "gp_session";
const LS_CLIENT = "gp_clientId";
const LS_USER = "gp_username";
const LS_EMAIL = "gp_email";
const LS_ORDERMS_TOKEN = "orderms_token";
const LS_INVOICE_TOKEN = "invoice_token";
const LS_INVOICE_USERID = "invoice_userId";

export type AuthState = {
  sessionId: string | null;
  clientId: string | null;
  username: string | null;
  email: string | null;
  orderMsToken: string | null;
  invoiceToken: string | null;
  invoiceUserId: string | null;
};

type AuthContextValue = AuthState & {
  login: (username: string, password: string, email: string) => Promise<void>;
  register: (username: string, password: string, email: string) => Promise<void>;
  logout: () => Promise<void>;
  setSessionFromCredentials: (
    sessionId: string,
    clientId: string,
    username: string,
    email?: string | null
  ) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readInitial(): AuthState {
  return {
    sessionId: localStorage.getItem(LS_SESSION),
    clientId: localStorage.getItem(LS_CLIENT),
    username: localStorage.getItem(LS_USER),
    email: localStorage.getItem(LS_EMAIL),
    orderMsToken: localStorage.getItem(LS_ORDERMS_TOKEN),
    invoiceToken: localStorage.getItem(LS_INVOICE_TOKEN),
    invoiceUserId: localStorage.getItem(LS_INVOICE_USERID),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(readInitial);

  const persist = useCallback((s: AuthState) => {
    if (s.sessionId) localStorage.setItem(LS_SESSION, s.sessionId);
    else localStorage.removeItem(LS_SESSION);
    if (s.clientId) localStorage.setItem(LS_CLIENT, s.clientId);
    else localStorage.removeItem(LS_CLIENT);
    if (s.username) localStorage.setItem(LS_USER, s.username);
    else localStorage.removeItem(LS_USER);
    if (s.email) localStorage.setItem(LS_EMAIL, s.email);
    else localStorage.removeItem(LS_EMAIL);
    if (s.orderMsToken) localStorage.setItem(LS_ORDERMS_TOKEN, s.orderMsToken);
    else localStorage.removeItem(LS_ORDERMS_TOKEN);
    if (s.invoiceToken) localStorage.setItem(LS_INVOICE_TOKEN, s.invoiceToken);
    else localStorage.removeItem(LS_INVOICE_TOKEN);
    if (s.invoiceUserId) localStorage.setItem(LS_INVOICE_USERID, s.invoiceUserId);
    else localStorage.removeItem(LS_INVOICE_USERID);
  }, []);

  const setSessionFromCredentials = useCallback(
    (sessionId: string, clientId: string, username: string, email?: string | null) => {
      const next: AuthState = {
        sessionId,
        clientId,
        username,
        email: email ?? state.email,
        orderMsToken: state.orderMsToken,
        invoiceToken: state.invoiceToken,
        invoiceUserId: state.invoiceUserId,
      };
      setState(next);
      persist(next);
    },
    [persist, state.email, state.orderMsToken, state.invoiceToken, state.invoiceUserId]
  );

  const login = useCallback(
    async (username: string, password: string, email: string) => {
      const res = await apiFetch<{
        sessionId: string;
        clientId: string;
        orderMsToken?: string;
        invoiceToken?: string;
        invoiceUserId?: string;
      }>("/sessions", {
        method: "POST",
        body: JSON.stringify({ username, password, email }),
      });
      const next: AuthState = {
        sessionId: res.sessionId,
        clientId: res.clientId,
        username: username.trim(),
        email: email.trim(),
        orderMsToken: res.orderMsToken ?? null,
        invoiceToken: res.invoiceToken ?? null,
        invoiceUserId: res.invoiceUserId ?? null,
      };
      setState(next);
      persist(next);
    },
    [persist]
  );

  const register = useCallback(
    async (username: string, password: string, email: string) => {
      await apiFetch("/clients", {
        method: "POST",
        body: JSON.stringify({ username, password, email }),
      });
    },
    []
  );

  const logout = useCallback(async () => {
    const sid = state.sessionId;
    if (sid) {
      try {
        await fetch(`${API_BASE}/sessions/${encodeURIComponent(sid)}`, {
          method: "DELETE",
        });
      } catch {
        /* still clear locally */
      }
    }
    const cleared: AuthState = {
      sessionId: null,
      clientId: null,
      username: null,
      email: null,
      orderMsToken: null,
      invoiceToken: null,
      invoiceUserId: null,
    };
    setState(cleared);
    persist(cleared);
  }, [persist, state.sessionId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      register,
      logout,
      setSessionFromCredentials,
    }),
    [state, login, register, logout, setSessionFromCredentials]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
