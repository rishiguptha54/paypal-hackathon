import { useEffect, useState } from 'react';
import { PayPalOneTimePaymentButton, PayPalProvider } from '@paypal/react-paypal-js/sdk-v6';
import type { Purchase, PublicConfig } from '@intentlock/shared';
import { ApiError, api } from './api';

function describe(e: unknown): string {
  if (e instanceof ApiError)
    return `${e.message} (${e.code}${e.requestId ? `, ${e.requestId}` : ''})`;
  return 'Something went wrong.';
}

/** Success is shown only when the server reports a COMPLETED status read from PayPal. */
function isVerified(p: Purchase): boolean {
  return p.state === 'CAPTURED' && p.paypalStatus === 'COMPLETED';
}

export function App() {
  const [config, setConfig] = useState<PublicConfig>();
  const [purchase, setPurchase] = useState<Purchase>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    api.config().then(setConfig, (e: unknown) => setMessage(describe(e)));
  }, []);

  const start = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      setPurchase(await api.createTestPurchase());
    } catch (e) {
      setMessage(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const open =
    purchase && !['CAPTURED', 'CAPTURE_PENDING', 'BLOCKED_AT_CAPTURE'].includes(purchase.state);

  return (
    <main>
      <h1>IntentLock</h1>
      <p className="badge">PayPal Sandbox · no real money</p>
      <p>Stage 1 money spine: server-priced $1.00 test purchase through PayPal.</p>

      {!purchase && (
        <button type="button" onClick={start} disabled={busy || !config}>
          {busy ? 'Creating…' : 'Create $1.00 test purchase'}
        </button>
      )}

      {purchase && config && open && (
        <section aria-label="Checkout">
          <p>
            {purchase.itemName} · <strong>{purchase.total.display}</strong>
          </p>
          <PayPalProvider
            clientId={config.paypalClientId}
            environment="sandbox"
            components={['paypal-payments']}
            pageType="checkout"
          >
            <PayPalOneTimePaymentButton
              createOrder={async () => {
                const { paypalOrderId } = await api.createOrder(purchase.id);
                return { orderId: paypalOrderId };
              }}
              onApprove={async ({ orderId }) => {
                try {
                  setPurchase(await api.capture(purchase.id, orderId));
                  setMessage(undefined);
                } catch (e) {
                  setMessage(describe(e));
                }
              }}
              onCancel={() => setMessage('Payment cancelled. You can try again.')}
              onError={() => setMessage('PayPal reported an error. Please try again.')}
            />
          </PayPalProvider>
        </section>
      )}

      {purchase && (
        <section aria-live="polite" aria-label="Status">
          <h2>Status</h2>
          <dl>
            <dt>Purchase</dt>
            <dd>{purchase.state}</dd>
            <dt>PayPal order</dt>
            <dd>{purchase.paypalOrderId ?? '—'}</dd>
            <dt>PayPal status (verified)</dt>
            <dd>{purchase.paypalStatus ?? '—'}</dd>
            <dt>Capture</dt>
            <dd>{purchase.paypalCaptureId ?? '—'}</dd>
          </dl>
          {isVerified(purchase) && <p className="ok">Verified by PayPal: payment COMPLETED.</p>}
          {purchase.state === 'BLOCKED_AT_CAPTURE' && (
            <p className="err">Capture blocked: {purchase.blockReasons?.join(', ')}</p>
          )}
          {(isVerified(purchase) || purchase.state === 'BLOCKED_AT_CAPTURE') && (
            <button type="button" onClick={() => setPurchase(undefined)}>
              Start another
            </button>
          )}
        </section>
      )}

      {message && (
        <p role="alert" className="err">
          {message}
        </p>
      )}
    </main>
  );
}
