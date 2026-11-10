import { useEffect, useRef, useState } from 'react';
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import type { IntentReceipt, LedgerRow } from '@intentlock/shared';
import { api } from './api';
import { describe } from './presentation';

ModuleRegistry.registerModules([AllCommunityModule]);

export function TextCell({ value }: Pick<CustomCellRendererProps<LedgerRow, unknown>, 'value'>) {
  return (
    <span>{Array.isArray(value) ? value.join(', ') : value == null ? '-' : String(value)}</span>
  );
}
const columns: ColDef<LedgerRow>[] = [
  { field: 'time', headerName: 'Timestamp', minWidth: 200 },
  { field: 'product', minWidth: 220 },
  { field: 'merchant', headerName: 'Merchant domain' },
  { field: 'decision' },
  { field: 'reasonCodes', headerName: 'Reason codes', minWidth: 240 },
  { field: 'approvalHashStatus', headerName: 'Approval hash' },
  { field: 'paypalOrderId', headerName: 'PayPal order ID', minWidth: 200 },
  { field: 'mcpTraceStatus', headerName: 'MCP trace' },
  { field: 'state', headerName: 'Capture status' },
  { field: 'source', headerName: 'Catalog source' },
  { field: 'seeded', headerName: 'Sample data' },
];

export function ReceiptDrawer({ receipt, close }: { receipt: IntentReceipt; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="receipt" aria-labelledby="receipt-title" onCancel={close}>
      <button className="close" type="button" onClick={close}>
        Close receipt
      </button>
      <h2 id="receipt-title">Intent Receipt</h2>
      <p className="badge">{receipt.chain} audit chain</p>
      {receipt.seeded && <p className="badge">Sample data - no payment occurred</p>}
      {receipt.purchase?.simulatedDrift && <p className="badge">Simulated Drift</p>}
      <p>{receipt.sandboxNotice}</p>
      <h3>1. Request</h3>
      <p>{receipt.requestText}</p>
      <h3>2. Confirmed mandate</h3>
      <pre>{JSON.stringify(receipt.mandate, null, 2)}</pre>
      <h3>3. Offer snapshot and deterministic policy</h3>
      <p>
        {receipt.offer.title} - {receipt.offer.merchantDomain ?? 'Unknown merchant'}
      </p>
      <p>
        {receipt.offer.decision} / {receipt.offer.source}
      </p>
      <ul>
        {receipt.offer.findings.map((f) => (
          <li key={f.code}>
            {f.code}: {f.message}
          </li>
        ))}
      </ul>
      <h3>4. Human approval</h3>
      <pre>{receipt.approval ? JSON.stringify(receipt.approval, null, 2) : 'Not approved'}</pre>
      <h3>5. PayPal MCP trace</h3>
      {receipt.mcpTrace.length ? (
        <ul>
          {receipt.mcpTrace.map((t, i) => (
            <li key={i}>
              {t.at}: {t.tool} - {t.status}, {t.durationMs} ms
              {t.fallbackToRest ? ' (REST fallback)' : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p>No MCP calls.</p>
      )}
      <h3>6. Final capture / block evidence</h3>
      <pre>{JSON.stringify({ purchase: receipt.purchase, paypal: receipt.paypal }, null, 2)}</pre>
      <h3>7. Chain of custody</h3>
      <ol>
        {receipt.events.map((e) => (
          <li key={e.seq}>
            #{e.seq} {e.type} - {e.createdAt}
            <br />
            <code>{e.entryHash}</code>
          </li>
        ))}
      </ol>
    </dialog>
  );
}

export function Ledger({ revision }: { revision: number }) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [receipt, setReceipt] = useState<IntentReceipt>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const load = async (after?: string) => {
    setBusy(true);
    try {
      const page = await api.ledger(after);
      setRows((old) => (after ? [...old, ...page.rows] : page.rows));
      setCursor(page.nextCursor);
      setMessage('');
    } catch (e) {
      setMessage(describe(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    api
      .ledger()
      .then(
        (page) => {
          if (active) {
            setRows(page.rows);
            setCursor(page.nextCursor);
            setMessage('');
          }
        },
        (e: unknown) => {
          if (active) setMessage(describe(e));
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const open = async (row: LedgerRow) => {
    if (row.kind === 'REQUEST_REJECTED') {
      setMessage(
        `${row.product}. REQUEST_REJECTED is recorded in the session audit chain. No purchase or payment was authorized.`,
      );
      return;
    }
    try {
      setReceipt(await api.receipt(row.kind, row.id));
    } catch (e) {
      setMessage(describe(e));
    }
  };
  return (
    <section aria-labelledby="ledger-title">
      <h2 id="ledger-title">Decision ledger</h2>
      <div className="toolbar">
        <label>
          Quick filter
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Decision, reason, merchant..."
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void load()}>
          Refresh ledger
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const v = await api.verify();
              setMessage(
                `${v.status}: ${v.checked} events checked${
                  v.status === 'BROKEN'
                    ? `; first broken index ${v.firstBrokenIndex}, sequence ${v.firstBrokenSeq}`
                    : ''
                }`,
              );
            } catch (e) {
              setMessage(describe(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Verify Audit Chain
        </button>
      </div>
      <p role="status">
        {busy
          ? 'Loading audit records...'
          : message || `${rows.length} records loaded. Select a row for its receipt.`}
      </p>
      {!busy && !rows.length && <p>No decisions yet. Search for offers or load sample history.</p>}
      <div className="ledger-grid">
        <AgGridReact<LedgerRow>
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: true,
            minWidth: 150,
            cellRenderer: TextCell,
          }}
          getRowId={({ data }) => `${data.kind}:${data.id}`}
          rowModelType="clientSide"
          quickFilterText={filter}
          onRowClicked={({ data }) => {
            if (data) void open(data);
          }}
          onCellKeyDown={(e) => {
            if (e.event instanceof KeyboardEvent && e.event.key === 'Enter' && e.data)
              void open(e.data);
          }}
        />
      </div>
      {cursor && (
        <button type="button" disabled={busy} onClick={() => void load(cursor)}>
          Load more records
        </button>
      )}
      {receipt && <ReceiptDrawer receipt={receipt} close={() => setReceipt(undefined)} />}
    </section>
  );
}
