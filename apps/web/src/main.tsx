import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Ship,
  Settings,
  Users,
  Building2,
  History,
  LogOut,
  ShieldCheck,
  Search,
  ChevronDown,
  HelpCircle,
  PanelLeftClose,
  ArrowRight,
  Check,
} from "lucide-react";
import type { SessionContext, SettingsView } from "@freightnaut/domain";
import { defaultSettings } from "@freightnaut/domain";
import { createApi } from "./api";
import { ShipmentPage } from "./ShipmentPage";
import { NumberingPage } from "./NumberingPage";
import { SettingsPage, accentText } from "./SettingsPage";
import { TeamPage } from "./TeamPage";
import { AccountsPage, AuditPage, PlatformPage } from "./AdminPages";
import { SignInScreen, OnboardingScreen } from "./AuthScreens";
import { Brand, Dialog, Skeleton } from "./ui";
import { CommandMenu } from "./CommandMenu";
import { NavigationContext, type LeaveGuard } from "./navigation";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./style.css";
const initialRoute = new URLSearchParams(location.search);
function App() {
  const [localSignup, setLocalSignup] = useState(false),
    [providersLoaded, setProvidersLoaded] = useState(false),
    [companyName, setCompanyName] = useState(""),
    [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [session, setSession] = useState<SessionContext | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [providers, setProviders] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [active, setActive] = useState(""),
    [page, setPage] = useState(initialRoute.get("view") ?? "shipments"),
    [settings, setSettings] = useState<SettingsView | null>(null),
    [settingsSection, setSettingsSection] = useState("company");
  const [selected, setSelected] = useState<string | null>(
      initialRoute.get("shipment"),
    ),
    [command, setCommand] = useState(false),
    [guide, setGuide] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [navigating, setNavigating] = useState(false);
  const leaveGuard = useRef<LeaveGuard | null>(null);
  const registerGuard = useCallback((guard: LeaveGuard) => {
    leaveGuard.current = guard;
    return () => {
      if (leaveGuard.current === guard) leaveGuard.current = null;
    };
  }, []);
  const [invitation, setInvitation] = useState(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    if (token) {
      sessionStorage.setItem("pendingInvitation", token);
      history.replaceState(null, "", location.pathname + location.search);
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
      setActive((old) => {
        const requested = old || initialRoute.get("workspace");
        return value.tenants.some((t) => t.id === requested) ||
          value.sharedShipments.some((g) => g.id === requested)
          ? requested!
          : (value.tenants.find((t) => t.kind === "account")?.id ??
              value.tenants[0]?.id ??
              value.sharedShipments[0]?.id ??
              "");
      });
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
      .then((response) => {
        if (!response.ok)
          throw new Error("Sign-in is unavailable. Please retry.");
        return response.json();
      })
      .then((value) => {
        setProviders(value.providers);
        setLocalSignup(value.registration === "local-self-service");
      })
      .catch((error) => setError(error.message))
      .finally(() => setProvidersLoaded(true));
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
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant?.id, tenant?.revision, api]);
  useEffect(() => {
    if (!session || !active) return;
    const params = new URLSearchParams();
    params.set("workspace", active);
    params.set("view", page);
    if (page === "shipments" && selected) params.set("shipment", selected);
    history.replaceState(null, "", location.pathname + "?" + params);
  }, [session?.user.id, active, page, selected]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (session && active) setCommand((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session?.user.id, active]);
  async function safely(action: () => void | Promise<void>) {
    setNavigating(true);
    setError("");
    try {
      await leaveGuard.current?.();
      await action();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Your changes could not be saved. Please retry before leaving.",
      );
    } finally {
      setNavigating(false);
    }
  }
  function navigate(id: string, section?: string) {
    void safely(() => {
      setPage(id);
      if (section) setSettingsSection(section);
      setSelected(null);
    });
  }
  function signOut() {
    void safely(async () => {
      await api("/api/auth/logout", { method: "POST" });
      setSession(null);
      setSettings(null);
      setActive("");
      setSelected(null);
      initialRoute.delete("workspace");
      initialRoute.delete("shipment");
      history.replaceState(null, "", "/");
    });
  }
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
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not accept invitation.",
      );
    }
  }
  function createWorkspace() {
    setCreatingWorkspace(true);
    setError("");
    void api<{ workspaceId: string }>("/api/onboarding/workspace", {
      method: "POST",
      body: JSON.stringify({ companyName }),
    })
      .then(async (result) => {
        setActive(result.workspaceId);
        setPage("shipments");
        await refresh();
      })
      .catch((error) => setError(error.message))
      .finally(() => setCreatingWorkspace(false));
  }
  if (loading || !providersLoaded)
    return (
      <div className="initial-loading">
        <Brand />
        <div className="loading-indicator" role="status">
          Opening your workspace…
        </div>
      </div>
    );
  if (!session)
    return (
      <SignInScreen
        providers={providers}
        localSignup={localSignup}
        error={error}
      />
    );
  if (!active && !session.operator && !invitation)
    return (
      <OnboardingScreen
        localSignup={localSignup}
        companyName={companyName}
        onCompanyChange={setCompanyName}
        onSubmit={createWorkspace}
        creating={creatingWorkspace}
        error={error}
        userId={session.user.id}
        onSignOut={signOut}
      />
    );
  const brand = settings?.values ?? defaultSettings,
    displayName = session.user.name || session.user.email;
  const initials = displayName
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
      group: "Workspace",
    },
    {
      id: "accounts",
      name: "Customer accounts",
      icon: Building2,
      show: tenant?.permissions.includes("partner.accounts.manage"),
      group: "Workspace",
    },
    {
      id: "team",
      name: "People & access",
      icon: Users,
      show: tenant?.permissions.includes("tenant.members.manage"),
      group: "Manage",
    },
    {
      id: "settings",
      name: "Workspace settings",
      icon: Settings,
      show: tenant?.permissions.includes("tenant.settings.write"),
      group: "Manage",
    },
    {
      id: "numbering",
      name: "Document numbering",
      icon: Settings,
      show:
        tenant?.kind === "account" &&
        (tenant.permissions.includes("tenant.settings.write") ||
          tenant.permissions.includes("document.number.reserve")),
      group: "Manage",
    },
    {
      id: "audit",
      name: "Activity",
      icon: History,
      show: tenant?.permissions.includes("tenant.audit.read"),
      group: "Manage",
    },
    {
      id: "platform",
      name: "Partner management",
      icon: ShieldCheck,
      show: session.operator,
      group: "Manage",
    },
  ].filter((item) => item.show);
  const current = menu.some((item) => item.id === page) ? page : menu[0]?.id;
  const pageName =
    menu.find((item) => item.id === current)?.name ?? "Workspace";
  return (
    <NavigationContext.Provider value={registerGuard}>
      <div
        className={"app-shell" + (collapsed ? " sidebar-collapsed" : "")}
        style={
          {
            "--workspace-primary": brand.primaryColor,
            "--workspace-accent": brand.accentColor,
            "--accent-ink": accentText(brand.accentColor),
          } as React.CSSProperties
        }
      >
        <aside className="sidebar">
          <div className="sidebar-brand">
            <Brand name={brand.brandName} compact={collapsed} />
          </div>
          <div className="sidebar-workspace">
            <span className="workspace-avatar">
              {(tenant?.name ?? shared?.name ?? "W").slice(0, 2).toUpperCase()}
            </span>
            <label>
              <span>Current workspace</span>
              <select
                aria-label="Active workspace"
                value={active}
                disabled={navigating}
                onChange={(event) => {
                  const value = event.target.value;
                  void safely(() => {
                    setActive(value);
                    setPage("shipments");
                    setSelected(null);
                  });
                }}
              >
                {session.tenants.some((t) => t.kind === "account") && (
                  <optgroup label="Workspaces">
                    {session.tenants
                      .filter((t) => t.kind === "account")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </optgroup>
                )}
                {session.tenants.some((t) => t.kind === "partner") && (
                  <optgroup label="Partner consoles">
                    {session.tenants
                      .filter((t) => t.kind === "partner")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · Partner console
                        </option>
                      ))}
                  </optgroup>
                )}
                {session.sharedShipments.length > 0 && (
                  <optgroup label="Shared shipments">
                    {session.sharedShipments.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · Shared shipment
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <ChevronDown size={14} />
          </div>
          <nav aria-label="Main navigation">
            {["Workspace", "Manage"].map((group) => (
              <div className="nav-group" key={group}>
                {menu.some((item) => item.group === group) && (
                  <p className="workspace-label">{group}</p>
                )}
                {menu
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.id}
                      className={"nav " + (current === item.id ? "active" : "")}
                      aria-label={item.name}
                      aria-current={current === item.id ? "page" : undefined}
                      title={collapsed ? item.name : undefined}
                      disabled={navigating}
                      onClick={() => navigate(item.id)}
                    >
                      <item.icon size={19} />
                      <span className="nav-label">{item.name}</span>
                      {current === item.id && (
                        <span className="nav-active-dot" />
                      )}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="workspace-guide" onClick={() => setGuide(true)}>
              <HelpCircle size={18} />
              <span>Workspace guide</span>
              <ArrowRight size={14} />
            </button>
            <div className="user-summary">
              <span className="profile">{initials}</span>
              <div>
                <strong title={displayName}>{displayName}</strong>
                <small>{tenant?.roleName ?? "External collaborator"}</small>
              </div>
              <button
                className="icon-button"
                title="Sign out"
                aria-label="Sign out"
                disabled={navigating}
                onClick={signOut}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        <div className="main-column">
          <header className="topbar">
            <div className="topbar-context">
              <button
                className="icon-button collapse-button"
                title={collapsed ? "Expand navigation" : "Collapse navigation"}
                aria-label={
                  collapsed ? "Expand navigation" : "Collapse navigation"
                }
                onClick={() => setCollapsed((value) => !value)}
              >
                <PanelLeftClose size={19} />
              </button>
              <span>
                {tenant?.kind === "partner" ? "Partner console" : "Workspace"}
              </span>
              <i>/</i>
              <strong>{pageName}</strong>
            </div>
            <button className="global-search" onClick={() => setCommand(true)}>
              <Search size={16} />
              <span>Search workspace</span>
              <kbd>⌘ K</kbd>
            </button>
            <span
              className="session-indicator"
              title={
                session.mfa
                  ? "Multi-factor authentication verified"
                  : "Signed in securely"
              }
            >
              <ShieldCheck size={16} />
              <span>Secure workspace</span>
            </span>
            <button
              className="icon-button mobile-signout"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={17} />
            </button>
          </header>
          <main
            className={"app-main" + (selected ? " editor-main" : "")}
            id="main-content"
          >
            {error && (
              <div role="alert" className="error global-error">
                {error}
                <button className="text-button" onClick={() => setError("")}>
                  Dismiss
                </button>
              </div>
            )}
            {invitation && (
              <div className="invitation-banner">
                <div>
                  <strong>You’ve been invited to a workspace</strong>
                  <p>Accept to access the documents shared with you.</p>
                </div>
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
            {active && tenant && !settings && (
              <Skeleton label="Loading workspace configuration" />
            )}
            {current === "shipments" && ((tenant && settings) || shared) && (
              <ShipmentPage
                key={active}
                tenant={tenant}
                shared={shared}
                settings={settings!}
                api={api}
                selectedId={selected}
                onSelected={setSelected}
                onConfigure={() => navigate("settings", "company")}
              />
            )}
            {current === "settings" && tenant && settings && (
              <SettingsPage
                key={tenant.id + ":" + settings.revision}
                tenant={tenant}
                settings={settings}
                api={api}
                initialSection={settingsSection}
                onSectionChange={setSettingsSection}
                onSaved={(value) => setSettings(value)}
              />
            )}
            {current === "numbering" && tenant && settings && (
              <NumberingPage
                key={tenant.id}
                tenant={tenant}
                settings={settings.values}
                api={api}
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
        {command && (
          <CommandMenu
            pages={menu}
            tenantId={tenant?.id}
            canReadShipments={!!tenant?.permissions.includes("shipment.read")}
            api={api}
            onClose={() => setCommand(false)}
            onNavigate={navigate}
            onOpenShipment={(id) => {
              void safely(() => {
                setPage("shipments");
                setSelected(id);
              });
            }}
          />
        )}
        {guide && (
          <Dialog
            title="A smoother shipment workflow"
            description="A few useful things to know before you get started."
            onClose={() => setGuide(false)}
          >
            <div className="guide-list">
              <div>
                <span>
                  <Check size={17} />
                </span>
                <div>
                  <h3>Shipment details save automatically</h3>
                  <p>
                    Wait for “Saved” before closing the browser. Switching pages
                    also saves shipment changes first. Workspace settings have a
                    separate Save changes button.
                  </p>
                </div>
              </div>
              <div>
                <span>
                  <Ship size={17} />
                </span>
                <div>
                  <h3>Start from a previous shipment</h3>
                  <p>
                    Find it by reference or consignee, then choose Copy shipment
                    to reuse the details in a new draft.
                  </p>
                </div>
              </div>
              <div>
                <span>
                  <Search size={17} />
                </span>
                <div>
                  <h3>Move around with your keyboard</h3>
                  <p>
                    Press ⌘ K or Ctrl K to find a page or shipment. Press Escape
                    to close a dialog.
                  </p>
                </div>
              </div>
            </div>
          </Dialog>
        )}
      </div>
    </NavigationContext.Provider>
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
      <div className="initial-loading">
        <Brand />
        <h1>The workspace could not be displayed.</h1>
        <p>Your saved changes are on the server.</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload workspace
        </button>
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
