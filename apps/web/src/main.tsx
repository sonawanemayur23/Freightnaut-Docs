import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Ship,
  Settings,
  Users,
  Building2,
  ClipboardList,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import type {
  SessionContext,
  SettingsView,
  TenantAccess,
} from "@freightnaut/domain";
import { defaultSettings } from "@freightnaut/domain";
import { createApi, type ApiClient } from "./api";
import { ShipmentPage } from "./ShipmentPage";
import { SettingsPage } from "./SettingsPage";
import { TeamPage } from "./TeamPage";
import { AccountsPage, AuditPage, PlatformPage } from "./AdminPages";
import "./style.css";
function App() {
  const [session, setSession] = useState<SessionContext | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [providers, setProviders] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [active, setActive] = useState(""),
    [page, setPage] = useState("shipments"),
    [settings, setSettings] = useState<SettingsView | null>(null);
  const [invitation, setInvitation] = useState(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get("token");
    if (value) {
      sessionStorage.setItem("pendingInvitation", value);
      history.replaceState(null, "", location.pathname);
    }
    return sessionStorage.getItem("pendingInvitation") ?? "";
  });
  const api = useMemo(
    () =>
      createApi(session?.csrfToken ?? "", () => {
        setSession(null);
        setSettings(null);
      }),
    [session?.csrfToken],
  );
  async function refresh() {
    try {
      const value = await api<SessionContext>("/api/auth/session");
      setSession(value);
      setActive((old) =>
        value.tenants.some((t) => t.id === old) ||
        value.sharedShipments.some((g) => g.id === old)
          ? old
          : (value.tenants[0]?.id ?? value.sharedShipments[0]?.id ?? ""),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("status" in error) ||
        error.status !== 401
      )
        setError(
          error instanceof Error
            ? error.message
            : "Could not load your session.",
        );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    void fetch("/api/auth/providers")
      .then((r) => {
        if (!r.ok) throw new Error("Sign-in service unavailable.");
        return r.json();
      })
      .then((r) => setProviders(r.providers))
      .catch((e) => setError(e.message));
  }, []);
  const tenant = session?.tenants.find((t) => t.id === active),
    shared = session?.sharedShipments.find((g) => g.id === active);
  useEffect(() => {
    setSettings(null);
    if (!tenant) return;
    let cancelled = false;
    void api<SettingsView>(`/api/tenants/${tenant.id}/settings`)
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant?.id, tenant?.revision, api]);
  async function acceptInvitation() {
    try {
      setError("");
      await api("/api/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: invitation }),
      });
      sessionStorage.removeItem("pendingInvitation");
      setInvitation("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept invitation.");
    }
  }
  if (loading)
    return (
      <div className="auth-screen">
        <div className="auth-card">Loading your workspace…</div>
      </div>
    );
  if (!session)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <span className="auth-mark">F</span>
          <h1>Welcome to Freightnaut Docs.</h1>
          <p>Sign in to your organization’s document workspace.</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {providers.map((provider) => (
            <a
              className="primary login-link"
              href={"/api/auth/login/" + provider.id}
              key={provider.id}
            >
              Continue with {provider.name}
            </a>
          ))}
          <p className="auth-note">
            Access is granted by invitation. Sign-in alone does not grant
            workspace access.
          </p>
        </div>
      </div>
    );
  const brand = settings?.values ?? defaultSettings;
  const initials = session.user.name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const menu = [
    {
      id: "shipments",
      name: "Shipments",
      icon: Ship,
      show: !!shared || tenant?.permissions.includes("shipment.read"),
    },
    {
      id: "settings",
      name: "Workspace settings",
      icon: Settings,
      show: tenant?.permissions.includes("tenant.settings.write"),
    },
    {
      id: "team",
      name: "People & access",
      icon: Users,
      show: tenant?.permissions.includes("tenant.members.manage"),
    },
    {
      id: "accounts",
      name: "Customer accounts",
      icon: Building2,
      show: tenant?.permissions.includes("partner.accounts.manage"),
    },
    {
      id: "audit",
      name: "Activity",
      icon: ClipboardList,
      show: tenant?.permissions.includes("tenant.audit.read"),
    },
    {
      id: "platform",
      name: "Partner management",
      icon: ShieldCheck,
      show: session.operator,
    },
  ].filter((m) => m.show);
  const current = menu.some((m) => m.id === page) ? page : menu[0]?.id;
  return (
    <div
      style={
        {
          "--workspace-primary": brand.primaryColor,
          "--workspace-accent": brand.accentColor,
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <div className="brand">
          <b>{brand.brandName[0]}</b>
          <strong>{brand.brandName}</strong>
        </div>
        <label className="workspace-picker">
          <span>Workspace</span>
          <select
            aria-label="Active workspace"
            value={active}
            onChange={(event) => {
              setActive(event.target.value);
              setPage("shipments");
              setError("");
            }}
          >
            {session.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.kind}
              </option>
            ))}
            {session.sharedShipments.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · Shared shipment
              </option>
            ))}
          </select>
        </label>
        <div className="top-context">
          {tenant?.roleName ??
            (shared ? "External collaborator" : "No workspace assigned")}
        </div>
        <span className="profile" title={session.user.name}>
          {initials}
        </span>
        <button
          aria-label="Sign out"
          className="icon-button"
          onClick={() => {
            void api("/api/auth/logout", { method: "POST" })
              .then(() => {
                setSession(null);
                setSettings(null);
                setActive("");
              })
              .catch((e) => setError(e.message));
          }}
        >
          <LogOut size={17} />
        </button>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="workspace-label">WORKSPACE</div>
          {menu.map((item) => (
            <button
              key={item.id}
              className={"nav " + (current === item.id ? "active" : "")}
              onClick={() => setPage(item.id)}
            >
              <item.icon size={18} />
              {item.name}
            </button>
          ))}
          <div className="sidebar-bottom">
            <strong>{session.user.name}</strong>
            <p>{session.user.email}</p>
            <p>{session.mfa ? "Multi-factor verified" : "Signed in"}</p>
          </div>
        </aside>
        <main>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {invitation && (
            <div className="invitation-banner">
              <span>You have a workspace invitation.</span>
              <button className="primary" onClick={acceptInvitation}>
                Accept invitation
              </button>
              <button
                className="secondary"
                onClick={() => {
                  sessionStorage.removeItem("pendingInvitation");
                  setInvitation("");
                }}
              >
                Dismiss
              </button>
            </div>
          )}
          {!active && !session.operator && (
            <section className="empty-state">
              <ShieldCheck size={28} />
              <h1>You’re signed in.</h1>
              <p>
                No workspace has been assigned yet. Accept your invitation or
                contact your administrator.
              </p>
              <details>
                <summary>Account identifier for your administrator</summary>
                <code>{session.user.id}</code>
              </details>
            </section>
          )}
          {active && tenant && !settings && (
            <div className="empty-state">Loading workspace configuration…</div>
          )}
          {current === "shipments" && ((tenant && settings) || shared) && (
            <ShipmentPage
              key={active}
              tenant={tenant}
              shared={shared}
              settings={settings!}
              api={api}
            />
          )}
          {current === "settings" && tenant && settings && (
            <SettingsPage
              key={tenant.id + ":" + settings.revision}
              tenant={tenant}
              settings={settings}
              api={api}
              onSaved={(value) => {
                setSettings(value);
              }}
            />
          )}
          {current === "team" && tenant && (
            <TeamPage
              key={tenant.id}
              tenant={tenant}
              api={api}
              onChanged={refresh}
            />
          )}
          {current === "accounts" && tenant && (
            <AccountsPage key={tenant.id} tenant={tenant} api={api} />
          )}
          {current === "audit" && tenant && (
            <AuditPage key={tenant.id} tenant={tenant} api={api} />
          )}
          {current === "platform" && session.operator && (
            <PlatformPage api={api} />
          )}
        </main>
      </div>
    </div>
  );
}
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>The workspace could not be displayed.</h1>
          <p>Your last saved changes are stored on the server.</p>
          <button className="primary" onClick={() => location.reload()}>
            Reload workspace
          </button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
