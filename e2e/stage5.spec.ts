import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.sandbox.paypal.com/web-sdk/v6/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        customElements.define('paypal-button', class extends HTMLElement {
          static get observedAttributes() { return ['disabled']; }
          attributeChangedCallback() {
            const button = this.querySelector('button');
            if (button) button.disabled = this.hasAttribute('disabled');
          }
          connectedCallback() {
            const button = document.createElement('button');
            button.textContent = 'PayPal Sandbox (mock)';
            button.disabled = this.hasAttribute('disabled');
            this.append(button);
          }
        });
        window.paypal = {
          version: '6.0.0-mock',
          createInstance: async () => ({
            destroy() {},
            createPayPalOneTimePaymentSession: (callbacks) => ({
              destroy() {},
              cancel() {},
              async start(options, orderPromise) {
                const { orderId } = await orderPromise;
                const approval = await fetch('/__test/paypal/approve', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderId })
                });
                if (!approval.ok) throw new Error('Mock buyer approval failed');
                await callbacks.onApprove({ orderId });
              }
            })
          })
        };
      `,
    }),
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'www.sandbox.paypal.com')
      return route.fallback();
    return route.abort('blockedbyclient');
  });
});

async function keyboardActivate(page: Page, name: string) {
  for (let i = 0; i < 80; i++) {
    const focused = page.locator(':focus');
    if ((await focused.count()) && (await focused.textContent()) === name) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard could not reach ${name}`);
}

async function openPurchase(page: Page, preset = 'Allowed purchase') {
  await page.goto('/');
  await page.getByRole('button', { name: preset }).click();
  await page.getByRole('button', { name: 'Draft mandate' }).click();
  await page.getByRole('button', { name: 'Confirm mandate and find offers' }).click();
  await expect(page.getByRole('heading', { name: 'ALLOWED' })).toBeVisible();
  await page.getByRole('button', { name: 'Select offer' }).first().click();
  await page.getByRole('button', { name: 'Approve this exact purchase' }).click();
  await expect(page.getByText('Server status: APPROVED')).toBeVisible();
}

test('E2E-01: user approval, PayPal MCP stub, capture, and verified receipt', async ({ page }) => {
  await openPurchase(page);
  await page.getByRole('button', { name: 'PayPal Sandbox (mock)' }).click();
  await expect(page.getByText(/Captured - verified with PayPal \(Sandbox\)/)).toBeVisible();
  await page.getByRole('button', { name: 'View Intent Receipt' }).click();
  await expect(page.getByRole('dialog')).toContainText('create_order');
  await expect(page.getByRole('dialog')).toContainText('get_order');
});

test('E2E-02: budget offers are blocked by policy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Over-budget offer' }).click();
  await page.getByRole('button', { name: 'Draft mandate' }).click();
  await page.getByRole('button', { name: 'Confirm mandate and find offers' }).click();
  await expect(page.getByText('OVER_BUDGET', { exact: false }).first()).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'BLOCKED offers' })
      .getByRole('button', { name: 'Select offer' })
      .first(),
  ).toBeDisabled();
});

test('E2E-05: recurring offers are blocked and not selectable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Allowed purchase' }).click();
  await page.getByRole('button', { name: 'Draft mandate' }).click();
  await page.getByRole('button', { name: 'Confirm mandate and find offers' }).click();
  const recurring = page
    .locator('article')
    .filter({ hasText: 'Office suite monthly subscription' });
  await expect(recurring).toContainText('RECURRING_NOT_ALLOWED');
  await expect(recurring.getByRole('button', { name: 'Select offer' })).toBeDisabled();
});

test('E2E-10: unexpected total is rejected and appears in the audit ledger', async ({ page }) => {
  await openPurchase(page);
  await page.getByRole('button', { name: 'Tamper demo: send an unexpected total' }).click();
  await expect(page.getByRole('alert')).toContainText('UNEXPECTED_FIELD');
  await page.getByRole('button', { name: 'Audit ledger' }).click();
  await page.getByRole('textbox', { name: 'Quick filter' }).fill('REQUEST_REJECTED');
  await expect(page.locator('.ag-row').first()).toContainText('REQUEST_REJECTED');
  await page.locator('.ag-row').first().click();
  await expect(page.getByRole('status')).toContainText('REQUEST_REJECTED');
});

test('E2E-12 and E2E-16: sample ledger persists, receipts open, and chain verifies', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load Sample Procurement History' }).click();
  await page.getByRole('button', { name: 'Audit ledger' }).click();
  await expect(page.locator('.ag-row').first()).toBeVisible();
  await page.getByRole('columnheader', { name: 'Product' }).click();
  await expect(page.getByRole('columnheader', { name: 'Product' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('textbox', { name: 'Quick filter' }).fill('BLOCKED');
  await expect(page.locator('.ag-row').first()).toContainText('BLOCKED');
  await page.locator('.ag-row').first().click();
  await expect(page.getByRole('dialog')).toContainText('Sample data - no payment occurred');
  await page.getByRole('button', { name: 'Close receipt' }).click();
  await page.getByRole('button', { name: 'Verify Audit Chain' }).click();
  await expect(page.getByRole('status')).toContainText('INTACT');
  await page.reload();
  await page.getByRole('button', { name: 'Audit ledger' }).click();
  await expect(page.getByRole('status')).toContainText('records loaded');
  await page.locator('.ag-row').first().click();
  await expect(page.getByRole('dialog')).toContainText('Sample data - no payment occurred');
});

test('E2E-13: keyboard-only purchase and axe scan through capture and receipt', async ({
  page,
}) => {
  await page.goto('/');
  await keyboardActivate(page, 'Allowed purchase');
  await keyboardActivate(page, 'Draft mandate');
  await expect(page.getByRole('heading', { name: 'Mandate', exact: true })).toBeVisible();
  await keyboardActivate(page, 'Confirm mandate and find offers');
  await expect(page.getByRole('heading', { name: 'ALLOWED' })).toBeVisible();
  await keyboardActivate(page, 'Select offer');
  await keyboardActivate(page, 'Approve this exact purchase');
  await expect(page.getByRole('button', { name: 'PayPal Sandbox (mock)' })).toBeVisible();
  await keyboardActivate(page, 'PayPal Sandbox (mock)');
  await expect(page.getByText('Server status: CAPTURED')).toBeVisible();
  await keyboardActivate(page, 'View Intent Receipt');
  await expect(page.getByRole('dialog')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);
});

test('E2E-14: Governance Studio shows chain evidence and adds a dashboard widget', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load Sample Procurement History' }).click();
  await page.getByRole('button', { name: 'Governance Studio' }).click();
  await expect(page.getByRole('region', { name: 'Governance analytics' })).toContainText('INTACT');
  await expect(page.getByRole('region', { name: 'Mandate Integrity & MCP Gate' })).toContainText(
    'DRIFT_AMOUNT_MISMATCH',
  );
  const assistant = page.getByRole('textbox', { name: 'Message input' });
  await assistant.fill('Explain blocks and add a widget by primary reason.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('The requested dashboard edit is complete.')).toBeVisible({
    timeout: 20_000,
  });
});

test('E2E-15: simulated post-approval drift blocks capture without calling capture', async ({
  page,
}) => {
  await openPurchase(page, 'Pre-capture drift');
  const before = (await (await page.request.get('/__test/stats')).json()) as { captures: number };
  await page.getByRole('button', { name: 'PayPal Sandbox (mock)' }).click();
  await expect(page.getByText('Server status: BLOCKED_AT_CAPTURE')).toBeVisible();
  await expect(page.getByText(/DRIFT_AMOUNT_MISMATCH/).last()).toBeVisible();
  await expect(page.getByText(/Simulated Drift: PRICE_HIKE/)).toBeVisible();
  const after = (await (await page.request.get('/__test/stats')).json()) as { captures: number };
  expect(after.captures).toBe(before.captures);
  await page.getByRole('button', { name: 'Audit ledger' }).click();
  await page.getByRole('textbox', { name: 'Quick filter' }).fill('BLOCKED_AT_CAPTURE');
  await expect(page.locator('.ag-row').first()).toContainText('DRIFT_AMOUNT_MISMATCH');
  await page.locator('.ag-row').first().click();
  await expect(page.getByRole('dialog')).toContainText('BLOCKED_AT_CAPTURE');
});

test('E2E-17: presets and merchant chips populate the mandate editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pre-capture drift' }).click();
  await expect(page.getByRole('textbox', { name: 'Purchase request' })).toHaveValue(
    /ergonomic desk chair/,
  );
  await page.getByRole('button', { name: 'Draft mandate' }).click();
  await page.getByRole('textbox', { name: 'Approved merchant domains' }).fill('');
  await page.getByRole('button', { name: 'northstar-office.example', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Approved merchant domains' })).toHaveValue(
    'northstar-office.example',
  );
});
