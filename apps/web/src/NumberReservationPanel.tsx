// filepath: apps/web/src/NumberReservationPanel.tsx
import { useEffect, useState } from "react";
import { Hash, RefreshCw } from "lucide-react";
import type {
  NumberReservation,
  SeriesRecord,
  DocumentType,
} from "@freightnaut/domain";
import type { ApiClient } from "./api";
export function NumberReservationPanel({
  tenantId,
  shipmentId,
  type,
  canReserve,
  api,
  prepare,
  onNumberChange,
}: {
  tenantId: string;
  shipmentId: string;
  type: DocumentType;
  canReserve: boolean;
  api: ApiClient;
  prepare: () => Promise<number>;
  onNumberChange: (number: string | undefined) => void;
}) {
  const path = `/api/tenants/${tenantId}/shipments/${shipmentId}/number-reservations`;
  const [history, setHistory] = useState<NumberReservation[]>([]),
    [series, setSeries] = useState<SeriesRecord[]>([]),
    [selected, setSelected] = useState(""),
    [branch, setBranch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [voiding, setVoiding] = useState(false),
    [loaded, setLoaded] = useState(false);
  async function refresh() {
    try {
      const result = await api<{ reservations: NumberReservation[] }>(path);
      setHistory(result.reservations);
      if (canReserve)
        setSeries(
          (
            await api<{ series: SeriesRecord[] }>(
              `/api/tenants/${tenantId}/number-series`,
            )
          ).series,
        );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, [path, canReserve]);
  const active = history.find(
      (record) => record.documentType === type && record.status === "reserved",
    ),
    chosen = series.find((record) => record.id === selected),
    options = series.filter(
      (record) => record.config.documentType === type && record.config.active,
    );
  useEffect(() => {
    onNumberChange(active?.number);
    setSelected("");
    setBranch("");
    setVoiding(false);
    setReason("");
  }, [active?.id, type]);
  async function reserve() {
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      const version = await prepare();
      await api(path, {
        method: "POST",
        body: JSON.stringify({
          version,
          seriesId: chosen.id,
          seriesRevision: chosen.revision,
          branch,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function voidNumber() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await api(path + "/" + active.id + "/void", {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setVoiding(false);
      setReason("");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="number-reservation"
      aria-label="Document number reservation"
    >
      <header>
        <div>
          <Hash size={18} />
          <h3>{type === "invoice" ? "Invoice" : "Packing list"} number</h3>
          <span>Reservation · Not issued</span>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh number reservation"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!loaded ? (
        <p className="field-hint">Loading number history…</p>
      ) : active ? (
        <>
          <div className="reserved-number">
            <code>{active.number}</code>
            <span className="status-pill">Reserved</span>
          </div>
          <p className="field-hint">
            {active.seriesName} · {active.branch} · Series revision{" "}
            {active.seriesRevision}. Prepare a new draft to include this number;
            previous files stay unchanged.
          </p>
          {canReserve && !voiding && (
            <button
              className="text-button danger-text"
              onClick={() => setVoiding(true)}
            >
              Void reservation
            </button>
          )}
          {canReserve && voiding && (
            <div className="void-form">
              <label>
                Reason for voiding
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <p className="field-hint">
                This number stays in history and will never be reused.
              </p>
              <div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setVoiding(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void voidNumber()}
                >
                  Confirm void
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="field-hint">
            This document has no reserved number. Draft previews and downloads
            do not allocate one.
          </p>
          {canReserve && options.length > 0 ? (
            <div className="reservation-controls">
              <label>
                Number series
                <select
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    const value = series.find(
                      (row) => row.id === event.target.value,
                    );
                    setBranch(
                      value?.config.branches.length === 1
                        ? value.config.branches[0].code
                        : "",
                    );
                  }}
                >
                  <option value="">Choose a series</option>
                  {options.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.config.name}
                    </option>
                  ))}
                </select>
              </label>
              {chosen && (
                <label>
                  Branch
                  <select
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                  >
                    <option value="">Choose a branch</option>
                    {chosen.config.branches.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {chosen && branch && (
                <small>
                  Next estimate:{" "}
                  {chosen.next.find((item) => item.branch === branch)?.number}
                </small>
              )}
              <button
                className="primary"
                disabled={busy || !chosen || !branch}
                onClick={() => void reserve()}
              >
                {busy ? "Reserving…" : "Reserve number"}
              </button>
              <small>
                Reserving consumes a number permanently. Complete the required
                shipment details first.
              </small>
            </div>
          ) : canReserve ? (
            <p className="field-hint">
              Configure an active series in Document numbering to reserve a
              number.
            </p>
          ) : null}
        </>
      )}
      {history.some(
        (record) => record.documentType === type && record.status === "voided",
      ) && (
        <details className="number-history">
          <summary>Voided number history</summary>
          {history
            .filter(
              (record) =>
                record.documentType === type && record.status === "voided",
            )
            .map((record) => (
              <div key={record.id}>
                <code>{record.number}</code>
                <p>{record.voidReason}</p>
              </div>
            ))}
        </details>
      )}
    </section>
  );
}
