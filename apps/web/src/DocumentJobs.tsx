// filepath: apps/web/src/DocumentJobs.tsx
import { useEffect, useState, useRef } from "react";
import {
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { ApiClient } from "./api";
export interface DocumentJob {
  id: string;
  documentType: "invoice" | "packing-list";
  shipmentVersion: number;
  status: "queued" | "processing" | "ready" | "failed";
  errorCode: string | null;
  createdAt: string;
  snapshotHash: string;
  documentNumber?: string | null;
}
export function DocumentJobs({
  path,
  api,
  activeId,
  onSettled,
  locale,
  timeZone,
}: {
  path: string;
  api: ApiClient;
  activeId: string | null;
  onSettled: () => void;
  locale: string;
  timeZone: string;
}) {
  const [jobs, setJobs] = useState<DocumentJob[]>([]),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState("");
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const downloaded = useRef(new Set<string>());
  async function save(job: DocumentJob, signal?: AbortSignal) {
    setBusy(job.id);
    setError("");
    try {
      const blob = await api<Blob>(
        path + "/" + job.id + "/file",
        { signal },
        true,
      );
      if (signal?.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `${job.documentType}-v${job.shipmentVersion}-draft.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!signal?.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Could not download this document.",
        );
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const result = await api<{ jobs: DocumentJob[] }>(path, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJobs(result.jobs);
        setError("");
        const active = result.jobs.find((job) => job.id === activeId);
        if (active?.status === "ready" && !downloaded.current.has(active.id)) {
          downloaded.current.add(active.id);
          await save(active, controller.signal);
          if (!controller.signal.aborted) settled.current();
        }
        if (active?.status === "failed") {
          setError(
            active.errorCode === "access_revoked"
              ? "Access changed while this document was being prepared."
              : "The PDF could not be prepared after several attempts. Choose Download draft again to prepare a new request.",
          );
          settled.current();
        }
        if (
          !controller.signal.aborted &&
          (result.jobs.some((job) =>
            ["queued", "processing"].includes(job.status),
          ) ||
            (activeId && !active))
        )
          timer = setTimeout(() => void refresh(), 2000);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(
            error instanceof Error
              ? error.message
              : "Document history could not be loaded.",
          );
          if (activeId) settled.current();
        }
      }
    }
    void refresh();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [path, api, activeId, retry]);
  return (
    <section className="document-history" aria-label="Saved draft documents">
      <header>
        <div>
          <h2>Saved drafts</h2>
          <p>
            Each request keeps the shipment details and settings used to prepare
            it.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh document history"
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Refresh status
          </button>
        </div>
      )}
      {!jobs.length ? (
        <div className="document-history-empty">
          <FileText size={20} />
          <p>Your saved drafts will appear here when you prepare a PDF.</p>
        </div>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <span className={"job-state job-" + job.status}>
                {job.status === "processing" ? (
                  <LoaderCircle className="spin" size={18} />
                ) : job.status === "ready" ? (
                  <CheckCircle2 size={18} />
                ) : job.status === "failed" ? (
                  <AlertCircle size={18} />
                ) : (
                  <Clock size={18} />
                )}
              </span>
              <div>
                <strong>
                  {job.documentType === "invoice"
                    ? "Commercial invoice"
                    : "Packing list"}{" "}
                  <span>
                    Shipment v{job.shipmentVersion}
                    {job.documentNumber
                      ? ` · Number at preparation: ${job.documentNumber}`
                      : ""}
                  </span>
                </strong>
                <small>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone,
                  }).format(new Date(job.createdAt))}{" "}
                  ·{" "}
                  {
                    {
                      queued: "Queued",
                      processing: "Preparing PDF",
                      ready: "Ready to download",
                      failed: "Preparation failed",
                    }[job.status]
                  }
                </small>
              </div>
              {job.status === "ready" && (
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void save(job)}
                >
                  <Download size={15} />
                  {busy === job.id ? "Downloading…" : "Download"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer>
        Draft documents · Latest 50 requests · Saved files stay unchanged when
        shipment details change.
      </footer>
    </section>
  );
}
