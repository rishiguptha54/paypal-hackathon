// Stub PayPal MCP server for tests. Mirrors the tool surface verified on @paypal/mcp 1.8.1:
// create_order and get_order, results returned as JSON text. Behaviour is switched by STUB_MODE.
import { appendFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mode = process.env.STUB_MODE ?? 'ok';
const log = (entry) => {
  if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, `${JSON.stringify(entry)}\n`);
};

log({
  event: 'start',
  hasToken: Boolean(process.env.PAYPAL_ACCESS_TOKEN),
  hasSecret: Boolean(process.env.PAYPAL_CLIENT_SECRET),
  args: process.argv.slice(2),
});

const tool = (name) => ({
  name,
  description: `stub ${name}`,
  inputSchema: { type: 'object', properties: {}, additionalProperties: true },
});

const orders = new Map();
let counter = 0;
const text = (t) => ({ content: [{ type: 'text', text: t }] });

const server = new Server(
  { name: 'stub-paypal-mcp', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];
  if (mode !== 'missing_tools') tools.push(tool('create_order'));
  tools.push(tool('get_order'));
  if (mode === 'extra_tools') tools.push(tool('capture_order'));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  log({ event: 'call', name });
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 3000));
  if (mode === 'malformed') return text('definitely not json');
  if (mode === 'error_json')
    return text(JSON.stringify({ error: { message: 'boom', type: 'paypal_error' } }));

  if (name === 'create_order') {
    const total = (args.items ?? []).reduce((s, i) => s + i.itemTotal, 0).toFixed(2);
    const id = `STUBORDER${String(++counter).padStart(8, '0')}`;
    orders.set(id, total);
    return text(JSON.stringify({ id, status: 'CREATED', links: [] }));
  }
  if (name === 'get_order') {
    const total = orders.get(args.id) ?? process.env.STUB_AMOUNT ?? '1.00';
    return text(
      JSON.stringify({
        id: args.id,
        status: process.env.STUB_ORDER_STATUS ?? 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: total } }],
      }),
    );
  }
  return text(JSON.stringify({ error: { message: 'unknown tool', type: 'paypal_error' } }));
});

await server.connect(new StdioServerTransport());

if (process.env.STUB_EXIT_AFTER_MS) {
  setTimeout(() => process.exit(0), Number(process.env.STUB_EXIT_AFTER_MS));
}
