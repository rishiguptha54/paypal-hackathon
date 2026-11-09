import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PayPalOneTimePaymentButton, PayPalProvider } from '@paypal/react-paypal-js/sdk-v6';
import {
  MandateFieldsSchema, type DriftKind, type EvaluatedOffer, type Mandate,
  type Purchase, type PublicConfig,
} from '@intentlock/shared';
import { api } from './api';
import { Ledger, ReceiptDrawer } from './Ledger';
import { describe } from './presentation';
import type { IntentReceipt } from '@intentlock/shared';

const Governance = lazy(() => import('./Studio'));
const steps = ['Request', 'Mandate', 'Offers', 'Approval', 'Checkout'];
type Tab = 'buy' | 'ledger' | 'studio';

export function App() {
  const [config, setConfig] = useState<PublicConfig>();
  const [tab, setTab] = useState<Tab>('buy');
  const [step, setStep] = useState(0);
  const [text, setText] = useState('');
  const [mandate, setMandate] = useState<Mandate>();
  const [fields, setFields] = useState({ productQuery: '', quantity: '', maxTotal: '',
    domains: '', recurringAllowed: false, excluded: '' });
  const [offers, setOffers] = useState<EvaluatedOffer[]>([]);
  const [source, setSource] = useState<string>();
  const [purchase, setPurchase] = useState<Purchase>();
  const [receipt, setReceipt] = useState<IntentReceipt>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [drift, setDrift] = useState<DriftKind>('PRICE_HIKE');
  const [armed, setArmed] = useState(false);
  const driftRef = useRef({ armed, drift });
  useEffect(() => { driftRef.current = { armed, drift }; }, [armed, drift]);
  const heading = useRef<HTMLHeadingElement>(null);

  const updatePurchase = (p: Purchase) => {
    setPurchase(p);
    sessionStorage.setItem('intentlock-purchase', p.id);
    setRevision((n) => n + 1);
  };
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); }
    catch (e) { setMessage(describe(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    api.config().then(setConfig, (e: unknown) => setMessage(describe(e)));
    const id = sessionStorage.getItem('intentlock-purchase');
    if (id) api.purchase(id).then((p) => { setPurchase(p); setStep(4); },
      (e: unknown) => { sessionStorage.removeItem('intentlock-purchase'); setMessage(describe(e)); });
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step, tab]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!purchase || !['CAPTURING', 'CAPTURE_PENDING'].includes(purchase.state)) return;
    const timer = window.setInterval(() => {
      api.purchase(purchase.id).then(updatePurchase, (e: unknown) => setMessage(describe(e)));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [purchase]);

  const domainList = fields.domains.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const valid = MandateFieldsSchema.safeParse({
    productQuery: fields.productQuery, quantity: fields.quantity ? Number(fields.quantity) : undefined,
    maxTotal: fields.maxTotal, currency: 'USD', allowedMerchantDomains: domainList,
    recurringAllowed: fields.recurringAllowed,
    excludedTerms: fields.excluded.split(',').map((s) => s.trim()).filter(Boolean),
  });
  const canConfirm = valid.success && /[1-9]/.test(fields.maxTotal);
  const seconds = purchase?.approvalExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(purchase.approvalExpiresAt) - now) / 1000)) : undefined;
  const open = purchase && ['PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATED'].includes(purchase.state);
  const selected = offers.find((o) => o.snapshotId === purchase?.offerSnapshotId);
  const reset = () => {
    setPurchase(undefined); setMandate(undefined); setOffers([]); setStep(0); setArmed(false);
    sessionStorage.removeItem('intentlock-purchase');
  };

  return <div className="app-shell">
    <header>
      <div><p className="eyebrow">POLICY BEFORE PAYMENT</p><h1>IntentLock</h1></div>
      <span className="badge">PayPal Sandbox - no real merchant purchase</span>
      <nav aria-label="Main navigation">
        {([['buy', 'Procurement'], ['ledger', 'Audit ledger'], ['studio', 'Governance Studio']] as const)
          .map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}>{label}</button>)}
      </nav>
    </header>
    <main>
      <h2 ref={heading} tabIndex={-1}>{tab === 'buy' ? steps[step] : tab === 'ledger' ? 'Audit ledger' : 'Governance Studio'}</h2>
      {message && <div role="alert" className="notice">{message}</div>}
      {!config && <p role="status">Loading public configuration...</p>}
      {tab === 'buy' && <>
        <ol className="steps" aria-label="Purchase progress">{steps.map((s, i) =>
          <li key={s} aria-current={step === i ? 'step' : undefined}>{i + 1}. {s}</li>)}</ol>
        <p>AI drafts the intent. Deterministic server rules decide. Only you approve.</p>
        {step === 0 && <form className="panel" onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            const draft = await api.draft(text);
            setMandate(draft);
            setFields({ productQuery: draft.productQuery ?? '', quantity: draft.quantity?.toString() ?? '',
              maxTotal: draft.maxTotal ?? '', domains: draft.allowedMerchantDomains?.join(', ') ?? '',
              recurringAllowed: draft.recurringAllowed, excluded: draft.excludedTerms.join(', ') });
            setStep(1); setRevision((n) => n + 1);
          });
        }}>
          <h3>What should the agent find?</h3>
          <div className="chips">{config?.scenarioPresets.map((s) =>
            <button type="button" key={s.id} onClick={() => {
              setText(s.requestText); setArmed(s.id === 'PRECAPTURE_DRIFT');
            }}>{s.label}</button>)}</div>
          <label htmlFor="request">Purchase request</label>
          <textarea id="request" value={text} minLength={2} maxLength={1000} required
            placeholder="Buy 1 ergonomic desk chair under $120. No subscriptions."
            onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={busy || !config || text.trim().length < 2}>
            {busy ? 'Interpreting...' : 'Draft mandate'}</button>
        </form>}
        {step === 1 && mandate && <form className="panel" onSubmit={(e) => {
          e.preventDefault();
          if (!canConfirm || !valid.success) return;
          void perform(async () => {
            const confirmed = await api.confirm(mandate.id, valid.data);
            setMandate(confirmed); setPurchase(undefined); sessionStorage.removeItem('intentlock-purchase');
            setOffers([]); setStep(2); setRevision((n) => n + 1);
            const found = await api.search(confirmed.id);
            setOffers(found.offers); setSource(found.source); setRevision((n) => n + 1);
          });
        }}>
          <h3>Review every constraint</h3>
          <p>Version {mandate.version} - parser: {mandate.parser}. Editing a confirmed mandate creates a new version and invalidates uncaptured approvals.</p>
          {mandate.clarificationQuestions.length > 0 && <div className="notice">
            <strong>Clarification needed - no quantity or budget is guessed.</strong>
            <ul>{mandate.clarificationQuestions.map((q) => <li key={q.field}>{q.question}</li>)}</ul>
          </div>}
          <label>Product<input value={fields.productQuery} maxLength={200} required
            onChange={(e) => setFields({ ...fields, productQuery: e.target.value })} /></label>
          <div className="form-row">
            <label>Quantity<input type="number" min={1} max={100} value={fields.quantity} required
              onChange={(e) => setFields({ ...fields, quantity: e.target.value })} /></label>
            <label>Maximum total (USD)<input inputMode="decimal" value={fields.maxTotal} required
              onChange={(e) => setFields({ ...fields, maxTotal: e.target.value })} /></label>
            <label>Currency<input value="USD" readOnly /></label>
          </div>
          <label>Approved merchant domains (comma separated)<textarea value={fields.domains} required
            onChange={(e) => setFields({ ...fields, domains: e.target.value })} /></label>
          <div className="chips" aria-label="Merchant presets">{config?.merchantPresets.map((domain) =>
            <button type="button" key={domain} aria-pressed={domainList.includes(domain)}
              onClick={() => setFields({ ...fields,
                domains: [...new Set([...domainList, domain])].join(', ') })}>{domain}</button>)}</div>
          <label className="check"><input type="checkbox" checked={fields.recurringAllowed}
            onChange={(e) => setFields({ ...fields, recurringAllowed: e.target.checked })} />Allow recurring commitments</label>
          <label>Excluded terms (comma separated)<input value={fields.excluded}
            onChange={(e) => setFields({ ...fields, excluded: e.target.value })} /></label>
          {!canConfirm && <p className="hint">Enter a product, quantity 1-100, positive USD budget and at least one valid merchant domain.</p>}
          <button type="submit" disabled={busy || !canConfirm}>Confirm mandate and find offers</button>
        </form>}
        {step === 2 && mandate && <section>
          <div className="toolbar">
            <button type="button" disabled={busy} onClick={() => setStep(1)}>Edit mandate</button>
            <button type="button" disabled={busy} onClick={() => void perform(async () => {
              const found = await api.search(mandate.id); setOffers(found.offers); setSource(found.source);
              setRevision((n) => n + 1);
            })}>Search again</button>
            {source && <span className="badge">{source === 'channel3' ? 'Live: Channel3' : 'Fixture Catalog'}</span>}
          </div>
          {source === 'fixture' && config?.productSource === 'channel3' &&
            <p role="alert" className="notice">Live catalog unavailable. These are labelled fictional fixture results, not live offers.</p>}
          {busy && <p role="status">Searching and running every policy rule...</p>}
          {!busy && !offers.length && <p>No offers loaded. Retry search or change the mandate.</p>}
          {(['ALLOWED', 'BLOCKED', 'NEEDS_REVIEW'] as const).map((decision) =>
            <section key={decision} aria-label={`${decision} offers`}><h3>{decision.replaceAll('_', ' ')}</h3>
              <div className="offer-grid">{offers.filter((o) => o.decision === decision).map((o) =>
                <article key={o.snapshotId} className={`offer ${decision.toLowerCase()}`}>
                  <span className="badge">{o.source === 'channel3' ? 'Live: Channel3' : 'Fixture Catalog'}</span>
                  {o.seeded && <span className="badge">Sample data</span>}
                  <h4>{o.title}</h4><p>{o.merchantDomain ?? 'Unknown merchant'}</p>
                  <p className="price">{o.totalPrice?.display ?? 'Price unknown'}</p>
                  <p>Recurrence: {o.recurrenceSignal}</p>
                  <ul>{o.findings.map((f) => <li key={f.code}><code>{f.code}</code><br />{f.message}</li>)}</ul>
                  <div className="toolbar">
                    <button type="button" disabled={busy || decision !== 'ALLOWED'} onClick={() =>
                      void perform(async () => {
                        updatePurchase(await api.select(mandate.id, o.snapshotId)); setStep(3);
                      })}>Select offer</button>
                    <button type="button" onClick={() => void perform(async () =>
                      setReceipt(await api.receipt('OFFER', o.snapshotId)))}>View receipt</button>
                  </div>
                </article>)}</div>
            </section>)}
        </section>}
        {step >= 3 && purchase && <section className="panel" aria-label="Exact order review">
          <h3>{purchase.itemName}</h3>
          <dl>
            <dt>Merchant</dt><dd>{selected?.merchantDomain ?? 'See server receipt'}</dd>
            <dt>Quantity</dt><dd>{purchase.quantity}</dd>
            <dt>Unit price</dt><dd>{purchase.unitPrice.display} ({purchase.unitPrice.minor} minor units)</dd>
            <dt>Total from server</dt><dd>{purchase.total.display} {purchase.total.currency} ({purchase.total.minor} minor units)</dd>
            <dt>Mandate hash</dt><dd><code>{purchase.mandateHash}</code></dd>
          </dl>
          {purchase.seeded && <p className="badge">Sample data</p>}
          {purchase.simulatedDrift && <p className="badge">Simulated Drift: {purchase.simulatedDrift}</p>}
          {purchase.approvalExpiresAt && <p role="timer" aria-label="Approval time remaining">
            Approval expires in {Math.floor((seconds ?? 0) / 60)}:{String((seconds ?? 0) % 60).padStart(2, '0')}
            {seconds === 0 ? ' - expired; start a new approval.' : ''}</p>}
          {purchase.state === 'PENDING_APPROVAL' && <button type="button" disabled={busy || !purchase.mandateHash}
            onClick={() => void perform(async () => {
              if (!purchase.mandateHash) throw new Error('Missing approval hash');
              updatePurchase(await api.approve(purchase.id, purchase.mandateHash)); setStep(4);
            })}>Approve this exact purchase</button>}
          {config && ['APPROVED', 'ORDER_CREATED'].includes(purchase.state) && seconds !== 0 &&
            <PayPalProvider clientId={config.paypalClientId} environment="sandbox"
              components={['paypal-payments']} pageType="checkout">
              <PayPalOneTimePaymentButton
                createOrder={async () => {
                  const created = await api.createOrder(purchase.id);
                  updatePurchase(await api.purchase(purchase.id));
                  return { orderId: created.paypalOrderId };
                }}
                onApprove={async ({ orderId }) => {
                  await perform(async () => {
                    try {
                      if (config.demoControlsEnabled && driftRef.current.armed) {
                        updatePurchase(await api.drift(purchase.id, driftRef.current.drift));
                        setArmed(false);
                      }
                      updatePurchase(await api.capture(purchase.id, orderId));
                    } catch (e) {
                      updatePurchase(await api.purchase(purchase.id));
                      throw e;
                    }
                  });
                }}
                onCancel={async () => perform(async () => {
                  updatePurchase(await api.cancel(purchase.id)); setMessage('Buyer cancelled. No capture requested.');
                })}
                onError={() => setMessage('PayPal checkout failed. Retry or refresh the server status; no success is assumed.')}
              />
            </PayPalProvider>}
          <div className="toolbar">
            {open && <button type="button" disabled={busy} onClick={() => void perform(async () =>
              updatePurchase(await api.cancel(purchase.id)))}>Cancel purchase</button>}
            <button type="button" disabled={busy} onClick={() => void perform(async () =>
              updatePurchase(await api.purchase(purchase.id)))}>Refresh verified status</button>
            <button type="button" onClick={() => void perform(async () =>
              setReceipt(await api.receipt('PURCHASE', purchase.id)))}>View Intent Receipt</button>
            {mandate && open && <button type="button" disabled={busy} onClick={() => setStep(1)}>Edit mandate (new version)</button>}
          </div>
          <div aria-live="polite">
            <h3>Server status: {purchase.state}</h3>
            <p>PayPal order: {purchase.paypalOrderId ?? 'Not created'}</p>
            <p>PayPal status: {purchase.paypalStatus ?? 'Not verified'}</p>
            <p>Capture ID: {purchase.paypalCaptureId ?? 'None'}</p>
            {purchase.state === 'CAPTURED' && purchase.paypalStatus === 'COMPLETED' && !purchase.seeded &&
              <p className="notice success">Captured - verified with PayPal (Sandbox). This is not a real merchant purchase.</p>}
            {purchase.blockReasons?.map((f) => <p className="notice error" key={f.code}>{f.code}: {f.message}</p>)}
            {['CAPTURING', 'CAPTURE_PENDING'].includes(purchase.state) &&
              <p>Pending verification. Do not retry payment; refresh status. Unknown outcomes are not success.</p>}
            {purchase.state === 'CAPTURE_FAILED' && <p>Capture failed. Review the receipt and begin a new purchase if needed.</p>}
          </div>
          {!open && !['CAPTURING', 'CAPTURE_PENDING'].includes(purchase.state) &&
            <button type="button" onClick={reset}>Start another request</button>}
        </section>}
      </>}
      {tab === 'ledger' && <Ledger revision={revision} />}
      {tab === 'studio' && config && <Suspense fallback={<p role="status">Loading Governance Studio...</p>}>
        <Governance revision={revision} agentEnabled={config.studioAgentEnabled} />
      </Suspense>}
      {config?.demoControlsEnabled && <aside className="demo panel" aria-label="Demo controls">
        <h3>Demo controls - simulations only</h3>
        <p>Sample history makes no PayPal/MCP calls. Drift can only block capture, never permit it.</p>
        <button type="button" disabled={busy} onClick={() => void perform(async () => {
          await api.seed(); setRevision((n) => n + 1); setMessage('Sample procurement history loaded. All sample rows are labelled.');
        })}>Load Sample Procurement History</button>
        <button type="button" disabled={busy || !purchase} onClick={() => void perform(async () => {
          if (purchase) await api.tamper(purchase.id);
        })}>Tamper demo: send an unexpected total</button>
        <label className="check"><input type="checkbox" checked={armed}
          disabled={!!purchase && !['PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATED'].includes(purchase.state)}
          onChange={(e) => setArmed(e.target.checked)} />Simulate Post-Approval Drift at the next capture</label>
        <label>Drift scenario<select value={drift} onChange={(e) => setDrift(e.target.value as DriftKind)}>
          <option value="PRICE_HIKE">Price hike</option><option value="MERCHANT_SWAP">Merchant swap</option>
          <option value="APPROVAL_EXPIRED">Expired approval</option>
        </select></label>
        {purchase?.state === 'ORDER_CREATED' && <button type="button" disabled={busy}
          onClick={() => void perform(async () => updatePurchase(await api.drift(purchase.id, drift)))}>
          Apply drift to this order now</button>}
      </aside>}
    </main>
    {receipt && <ReceiptDrawer receipt={receipt} close={() => setReceipt(undefined)} />}
    <footer>IntentLock / deterministic purchase policy / Sandbox only</footer>
  </div>;
}
