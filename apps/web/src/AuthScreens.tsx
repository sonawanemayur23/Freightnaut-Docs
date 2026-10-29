import {
  ArrowRight,
  Check,
  FileCheck2,
  LockKeyhole,
  LogOut,
} from "lucide-react";
import { Brand, RouteArtwork } from "./ui";
import type { ReactNode } from "react";
function AuthLayout({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut?: () => void;
}) {
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div className="auth-story-copy">
          <span className="product-category">Export documentation</span>
          <h2>
            Trade paperwork.
            <br />
            Under control.
          </h2>
          <p>
            Bring your shipment details together. Prepare consistent documents,
            with a clear path from first draft to review.
          </p>
          <RouteArtwork />
          <div className="auth-story-feature">
            <FileCheck2 size={20} />
            <span>One shipment, every document in sync.</span>
          </div>
        </div>
        <footer>
          Freightnaut Docs<span>Built for the details that move trade.</span>
        </footer>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        {onSignOut && (
          <button className="auth-signout text-button" onClick={onSignOut}>
            <LogOut size={16} />
            Sign out
          </button>
        )}
        <div className="auth-content">{children}</div>
        <footer className="auth-footer">
          <LockKeyhole size={13} />
          Your workspace. Your people. Your documents.
        </footer>
      </main>
    </div>
  );
}
export function SignInScreen({
  providers,
  localSignup,
  error,
}: {
  providers: { id: string; name: string }[];
  localSignup: boolean;
  error: string;
}) {
  return (
    <AuthLayout>
      <span className="welcome-icon">
        <FileCheck2 size={25} />
      </span>
      <h1>Welcome to Freightnaut Docs.</h1>
      <p className="auth-intro">
        Your next shipment starts here. Sign in to continue to your workspace.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="text-button" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      )}
      <div className="auth-actions">
        {providers.map((provider) => (
          <a
            key={provider.id}
            className="primary login-link"
            href={"/api/auth/login/" + provider.id}
            aria-label={"Continue with " + provider.name}
          >
            {providers.length === 1 ? "Sign in" : provider.name}
            <ArrowRight size={17} />
          </a>
        ))}
      </div>
      {localSignup ? (
        <div className="auth-register">
          <span>New to Freightnaut?</span>
          <a href={"/api/auth/login/" + providers[0]?.id + "?intent=register"}>
            Create an account <ArrowRight size={14} />
          </a>
        </div>
      ) : (
        <p className="auth-note">
          New here? Use the invitation from your workspace administrator.
        </p>
      )}
      <div className="auth-trust">
        <Check size={15} />
        Shipment details stay in your workspace.
      </div>
    </AuthLayout>
  );
}
export function OnboardingScreen({
  localSignup,
  companyName,
  onCompanyChange,
  onSubmit,
  creating,
  error,
  userId,
  onSignOut,
}: {
  localSignup: boolean;
  companyName: string;
  onCompanyChange: (value: string) => void;
  onSubmit: () => void;
  creating: boolean;
  error: string;
  userId: string;
  onSignOut: () => void;
}) {
  return (
    <AuthLayout onSignOut={onSignOut}>
      <div className="onboarding-progress">
        <span className="done">
          <Check size={13} />
          Account created
        </span>
        <i />
        <span>Set up workspace</span>
      </div>
      <h1>
        {localSignup
          ? "Welcome. Let’s set up your workspace."
          : "You’re signed in."}
      </h1>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {localSignup ? (
        <>
          <p className="auth-intro">
            Give your workspace a name. You can add your company details and
            invite your team when you’re ready.
          </p>
          <form
            className="onboarding-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label>
              Company name
              <input
                autoFocus
                required
                maxLength={200}
                autoComplete="organization"
                placeholder="Your company’s name"
                value={companyName}
                onChange={(event) => onCompanyChange(event.target.value)}
              />
            </label>
            <p className="field-hint">
              This is how your workspace will appear to your team.
            </p>
            <button className="primary" disabled={creating}>
              {creating ? "Creating your workspace…" : "Create workspace"}
              <ArrowRight size={17} />
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="auth-intro">
            Accept your workspace invitation to get started, or ask your
            administrator to add you.
          </p>
          <details className="access-details">
            <summary>Share your account identifier</summary>
            <code>{userId}</code>
          </details>
        </>
      )}
    </AuthLayout>
  );
}
