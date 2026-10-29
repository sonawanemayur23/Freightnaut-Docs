import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  FileText,
  ShieldCheck,
  X,
} from "lucide-react";
export function Brand({
  name = "Freightnaut Docs",
  compact = false,
}: {
  name?: string;
  compact?: boolean;
}) {
  return (
    <div className={"brand" + (compact ? " brand-compact" : "")}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 28 28">
          <path d="M7 5h15v5H12v4h8v5h-8v5H7z" fill="currentColor" />
          <path d="m20 20 5 4v-8z" fill="#ffad13" />
        </svg>
      </span>
      {!compact && <strong>{name}</strong>}
    </div>
  );
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
export function Skeleton({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="skeleton-layout" role="status" aria-label={label}>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-description" />
      <div className="skeleton skeleton-toolbar" />
      {[0, 1, 2].map((i) => (
        <div className="skeleton skeleton-row" key={i} />
      ))}
    </div>
  );
}
export function Dialog({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef("dialog-" + crypto.randomUUID());
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"dialog" + (wide ? " dialog-wide" : "")}
      aria-labelledby={titleId.current}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="dialog-heading">
        <div>
          <h2 id={titleId.current}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function CopyLink({
  value,
  label = "Private invitation link",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setCopied(false);
    setFailed(false);
  }, [value]);
  return (
    <div className="copy-link">
      <label>
        {label}
        <span>
          <input
            readOnly
            value={value}
            onFocus={(event) => event.target.select()}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(value)
                .then(() => {
                  setCopied(true);
                  setFailed(false);
                })
                .catch(() => setFailed(true));
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied ? "Copied" : "Copy link"}
          </button>
        </span>
      </label>
      <small role="status">
        {failed
          ? "Select and copy the link above."
          : copied
            ? "Link copied. Share it with the intended person."
            : "No email is sent automatically. Share this link with the invited person."}
      </small>
    </div>
  );
}
export function DocumentArtwork() {
  return (
    <div className="document-artwork" aria-hidden="true">
      <div className="art-paper art-paper-back">
        <div className="art-paper-title">
          <FileText size={15} />
          Packing list
        </div>
        <div className="art-line" />
        <div className="art-line short" />
        <div className="art-table" />
      </div>
      <div className="art-paper">
        <div className="art-paper-title">
          <FileText size={15} />
          Commercial invoice
        </div>
        <div className="art-line" />
        <div className="art-line short" />
        <div className="art-table" />
        <div className="art-paper-footer">
          <Check size={13} />
          One shipment. Consistent details.
        </div>
      </div>
      <span className="art-check">
        <ShieldCheck size={22} />
      </span>
    </div>
  );
}
export function RouteArtwork() {
  return (
    <svg
      className="route-artwork"
      viewBox="0 0 600 320"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="route-grid"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill="currentColor" opacity=".13" />
        </pattern>
      </defs>
      <rect width="600" height="320" fill="url(#route-grid)" />
      <path
        d="M60 235C150 235 140 75 250 75S345 245 450 155s100-90 120-90"
        stroke="currentColor"
        opacity=".2"
        strokeWidth="1.5"
      />
      <path
        d="M80 230C200 230 180 80 300 80S400 210 520 130"
        stroke="#ffbd43"
        strokeWidth="2"
        strokeDasharray="5 7"
      />
      <circle cx="80" cy="230" r="7" fill="#ffbd43" />
      <circle cx="520" cy="130" r="7" fill="#ffbd43" />
      <circle cx="80" cy="230" r="19" stroke="#ffbd43" opacity=".25" />
      <circle cx="520" cy="130" r="19" stroke="#ffbd43" opacity=".25" />
      <rect
        x="260"
        y="142"
        width="130"
        height="82"
        rx="8"
        fill="#16385d"
        stroke="#365575"
      />
      <path
        d="M280 164h52m-52 12h84m-84 12h70m-70 12h35"
        stroke="#7d98b6"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m349 202 6 6 12-15"
        stroke="#ffbd43"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
