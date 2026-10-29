import { useEffect, useState } from "react";
import { ArrowRight, FileText, Search } from "lucide-react";
import { Dialog } from "./ui";
import type { ApiClient } from "./api";
export function CommandMenu({
  pages,
  onNavigate,
  onClose,
  tenantId,
  canReadShipments,
  onOpenShipment,
  api,
}: {
  pages: { id: string; name: string }[];
  onNavigate: (id: string) => void;
  onClose: () => void;
  tenantId?: string;
  canReadShipments: boolean;
  onOpenShipment: (id: string) => void;
  api: ApiClient;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<
      { id: string; reference: string; consignee: string }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!query.trim() || !tenantId || !canReadShipments) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ shipments: typeof results }>(
        `/api/tenants/${tenantId}/shipments?q=${encodeURIComponent(query)}&limit=5`,
        { signal: controller.signal },
      )
        .then((value) => setResults(value.shipments))
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, tenantId, canReadShipments]);
  const matching = pages.filter((page) =>
    page.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog title="Search workspace" onClose={onClose}>
      <div className="command-input">
        <Search size={20} />
        <input
          autoFocus
          aria-label="Search pages and shipment references"
          placeholder="Find a page or shipment…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError("");
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="command-results">
        {matching.length > 0 && (
          <>
            <p>Pages</p>
            {matching.map((page) => (
              <button
                key={page.id}
                onClick={() => {
                  onNavigate(page.id);
                  onClose();
                }}
              >
                <span>{page.name}</span>
                <ArrowRight size={15} />
              </button>
            ))}
          </>
        )}
        {results.length > 0 && (
          <>
            <p>Shipments</p>
            {results.map((row) => (
              <button
                key={row.id}
                onClick={() => {
                  onOpenShipment(row.id);
                  onClose();
                }}
              >
                <FileText size={17} />
                <span>
                  {row.reference || "Untitled shipment"}
                  <small>{row.consignee || "No consignee yet"}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </>
        )}
        {query && !matching.length && !results.length && (
          <div className="command-empty">
            No matches. Try a shipment reference or consignee name.
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="command-footer">
        Search is limited to the workspace you have access to.
      </footer>
    </Dialog>
  );
}
