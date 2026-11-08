import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PayPalRestClient } from '../../src/adapters/paypal/client';
import {
  PayPalMcpGateway,
  ToolNotAllowedError,
  buildCreateOrderArgs,
  defaultMcpLaunch,
} from '../../src/adapters/paypalMcp/gateway';
import { UpstreamError } from '../../src/errors';
import { createLogger } from '../../src/logger';
import { FakePayPal } from '../helpers/fakePaypal';

const STUB = fileURLToPath(new URL('../fixtures/stubMcpServer.mjs', import.meta.url));
const ORDER = {
  purchaseId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  itemName: 'Widget',
  quantity: 2,
  unitAmountMinor: 14900n,
};

const open: PayPalMcpGateway[] = [];
const dirs: string[] = [];

function setup(
  env: Record<string, string> = {},
  opts: { timeoutMs?: number; command?: string } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'il-mcp-'));
  dirs.push(dir);
  const logFile = path.join(dir, 'stub.log');
  const fake = new FakePayPal();
  const rest = new PayPalRestClient({
    clientId: 'id',
    clientSecret: 'super-secret',
    fetch: fake.fetch,
  });
  const gateway = new PayPalMcpGateway({
    rest,
    launch: opts.command
      ? { command: opts.command, args: [] }
      : { command: process.execPath, args: [STUB] },
    logger: createLogger({ level: 'silent' }),
    timeoutMs: opts.timeoutMs,
    extraEnv: { STUB_LOG: logFile, ...env },
  });
  open.push(gateway);
  const stubCalls = () =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : [];
  return { gateway, fake, stubCalls };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((g) => g.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('UNIT-MCP-01 PayPalMcpGateway', () => {
  it('connects to the stub, lists tools and reports ok', async () => {
    const { gateway } = setup();
    await gateway.start();
    expect(gateway.mcpStatus()).toBe('ok');
  });

  it('launches the child with a token only: no client secret, orders-only tools', async () => {
    process.env['PAYPAL_CLIENT_SECRET'] = 'super-secret';
    const { gateway, stubCalls } = setup();
    await gateway.start();
    delete process.env['PAYPAL_CLIENT_SECRET'];
    const start = stubCalls().find((c) => c['event'] === 'start');
    expect(start).toMatchObject({ hasToken: true, hasSecret: false });
    expect(start?.['args']).toContain('--tools=orders.create,orders.get');
    expect(JSON.stringify(start)).not.toContain('fake-token');
  });

  it('throws before sending for any tool outside the allow-list', async () => {
    const { gateway, stubCalls } = setup({ STUB_MODE: 'extra_tools' });
    await gateway.start();
    const schema = { parse: (v: unknown) => v };
    for (const name of ['capture_order', 'create_invoice', 'orders.capture', '']) {
      await expect(gateway.invokeTool(name, {}, schema)).rejects.toBeInstanceOf(
        ToolNotAllowedError,
      );
    }
    expect(stubCalls().filter((c) => c['event'] === 'call')).toHaveLength(0);
  });

  it('creates and reads an order through MCP and returns a trace summary', async () => {
    const { gateway, fake } = setup();
    await gateway.start();
    const created = await gateway.createOrder(ORDER);
    expect(created.trace).toMatchObject({
      tool: 'create_order',
      channel: 'mcp',
      status: 'ok',
      fallbackToRest: false,
    });
    expect(created.trace.orderId).toBe(created.data.id);
    const live = await gateway.getOrder(created.data.id);
    expect(live.trace).toMatchObject({ tool: 'get_order', channel: 'mcp', fallbackToRest: false });
    expect(live.data.purchase_units[0]?.amount.value).toBe('298.00');
    expect(fake.callsTo('POST', '/v2/checkout/orders')).toHaveLength(0);
  });

  it('rejects a malformed tool result via Zod and does not fall back after a send', async () => {
    const { gateway, fake } = setup({ STUB_MODE: 'malformed' });
    await gateway.start();
    await expect(gateway.createOrder(ORDER)).rejects.toMatchObject({
      provider: 'paypal_mcp',
      kind: 'error',
    });
    expect(fake.callsTo('POST', '/v2/checkout/orders')).toHaveLength(0);
  });

  it('treats a PayPal error payload returned as tool text as a failure', async () => {
    const { gateway } = setup({ STUB_MODE: 'error_json' });
    await gateway.start();
    await expect(gateway.mcpGetOrder('ABCDEFGHIJKLMNOPQ')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('maps a slow tool to a typed UPSTREAM_TIMEOUT', async () => {
    const { gateway } = setup({ STUB_MODE: 'slow' }, { timeoutMs: 600 });
    await gateway.start();
    await expect(gateway.mcpGetOrder('ABCDEFGHIJKLMNOPQ')).rejects.toMatchObject({
      provider: 'paypal_mcp',
      kind: 'timeout',
    });
  });

  it('does not retry create on REST after an MCP timeout (avoids duplicate orders)', async () => {
    const { gateway, fake } = setup({ STUB_MODE: 'slow' }, { timeoutMs: 600 });
    await gateway.start();
    await expect(gateway.createOrder(ORDER)).rejects.toMatchObject({ kind: 'timeout' });
    expect(fake.callsTo('POST', '/v2/checkout/orders')).toHaveLength(0);
  });

  it('falls back to REST for the read-only get_order when MCP fails', async () => {
    const { gateway, fake } = setup({ STUB_MODE: 'malformed' });
    await gateway.start();
    const rest = await fake.fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
      method: 'POST',
      body: JSON.stringify({ purchase_units: [{ amount: { value: '1.00' } }] }),
    });
    const { id } = (await rest.json()) as { id: string };
    const live = await gateway.getOrder(id);
    expect(live.trace).toMatchObject({ channel: 'rest', fallbackToRest: true });
  });

  it('fails health when the server lacks create_order, and falls back to REST for create', async () => {
    const { gateway, fake } = setup({ STUB_MODE: 'missing_tools' });
    await gateway.start();
    expect(gateway.mcpStatus()).toBe('down');
    const created = await gateway.createOrder(ORDER);
    expect(created.trace).toMatchObject({ channel: 'rest', fallbackToRest: true });
    expect(fake.callsTo('POST', '/v2/checkout/orders')[0]?.headers['paypal-request-id']).toBe(
      ORDER.requestId,
    );
  });

  it('starts without throwing when the MCP command cannot launch, then uses REST', async () => {
    const { gateway } = setup({}, { command: 'definitely-not-a-real-binary-xyz' });
    await expect(gateway.start()).resolves.toBeUndefined();
    expect(gateway.mcpStatus()).toBe('down');
    const created = await gateway.createOrder(ORDER);
    expect(created.trace.fallbackToRest).toBe(true);
  });

  it('reports down once the child process exits', async () => {
    const { gateway } = setup({ STUB_EXIT_AFTER_MS: '300' });
    await gateway.start();
    expect(gateway.mcpStatus()).toBe('ok');
    await new Promise((r) => setTimeout(r, 1200));
    expect(gateway.mcpStatus()).toBe('down');
  });

  it('converts minor units to MCP tool arguments at the boundary only', () => {
    expect(buildCreateOrderArgs(ORDER)).toEqual({
      currencyCode: 'USD',
      items: [{ name: 'Widget', quantity: 2, itemCost: 149, itemTotal: 298 }],
    });
    expect(
      buildCreateOrderArgs({ ...ORDER, quantity: 3, unitAmountMinor: 1999n }).items[0],
    ).toMatchObject({
      itemCost: 19.99,
      itemTotal: 59.97,
    });
  });

  it('resolves the pinned @paypal/mcp from node_modules (no npx download)', () => {
    const launch = defaultMcpLaunch();
    expect(launch.command).toBe(process.execPath);
    expect(launch.args[0]).toMatch(/@paypal[\\/]mcp[\\/]dist[\\/]index\.js$/);
    expect(defaultMcpLaunch('node  ./x.js')).toEqual({ command: 'node', args: ['./x.js'] });
  });
});
