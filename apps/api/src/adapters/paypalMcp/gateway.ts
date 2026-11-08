import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { CheckStatus } from '@intentlock/shared';
import { formatUsd } from '../../core/money';
import { UpstreamError } from '../../errors';
import type { Logger } from '../../logger';
import type { PayPalRestClient } from '../paypal/client';
import {
  CreatedOrderSchema,
  PayPalOrderSchema,
  type CreatedOrder,
  type CreateOrderInput,
  type PayPalOrder,
} from '../paypal/schemas';

/**
 * Verified against @paypal/mcp 1.8.1 / @paypal/agent-toolkit 1.11.0 (tools/list over stdio):
 * the server registers `create_order` and `get_order` when started with
 * `--tools=orders.create,orders.get`.
 */
export const ALLOWED_TOOLS = ['create_order', 'get_order'] as const;
export type ToolName = (typeof ALLOWED_TOOLS)[number];

export const MCP_TIMEOUT_MS = 15_000;
export const MCP_STARTUP_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const ITEM_NAME_MAX = 127;

export interface McpTrace {
  tool: ToolName;
  channel: 'mcp' | 'rest';
  status: 'ok' | 'error' | 'timeout';
  durationMs: number;
  at: string;
  orderId?: string;
  debugId?: string;
  /** True when the MCP path was unavailable and REST served this call. */
  fallbackToRest: boolean;
}

export interface GatewayCall<T> {
  data: T;
  trace: McpTrace;
  httpStatus?: number;
  debugId?: string;
}

/** The only PayPal surface the rest of the app may use for order create and read. */
export interface PayPalOrderGateway {
  createOrder(input: CreateOrderInput): Promise<GatewayCall<CreatedOrder>>;
  getOrder(orderId: string): Promise<GatewayCall<PayPalOrder>>;
  mcpStatus(): CheckStatus;
  close(): Promise<void>;
}

export interface McpLaunch {
  command: string;
  args: string[];
}

export class ToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`MCP tool "${tool}" is not on the allow-list`);
    this.name = 'ToolNotAllowedError';
  }
}

/** The MCP path could not be used at all (nothing was sent), so REST fallback is safe. */
class McpUnavailableError extends Error {}

export function defaultMcpLaunch(command?: string): McpLaunch {
  if (command?.trim()) {
    const [cmd, ...args] = command.trim().split(/\s+/);
    return { command: cmd as string, args };
  }
  // Pinned dependency resolved from node_modules: never downloaded at runtime (no npx).
  const entry = createRequire(import.meta.url).resolve('@paypal/mcp/dist/index.js');
  return { command: process.execPath, args: [entry] };
}

export interface PayPalMcpGatewayOptions {
  rest: PayPalRestClient;
  launch: McpLaunch;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
  /** Extra env for the child (tests only). The PayPal client secret must never be passed. */
  extraEnv?: Record<string, string>;
}

export class PayPalMcpGateway implements PayPalOrderGateway {
  private client: Client | null = null;
  private connecting: Promise<Client | null> | null = null;
  private tokenExpiresAt = 0;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: PayPalMcpGatewayOptions) {
    this.timeoutMs = opts.timeoutMs ?? MCP_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Never throws: an MCP start failure is logged loudly and the REST fallback takes over. */
  async start(): Promise<void> {
    const client = await this.ensureConnected();
    if (!client) {
      this.opts.logger.error(
        { mcpTool: 'startup' },
        'PayPal MCP server unavailable: order create/read will FALL BACK TO REST',
      );
    }
  }

  mcpStatus(): CheckStatus {
    return this.client ? 'ok' : 'down';
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    await c?.close().catch(() => undefined);
  }

  private ensureConnected(): Promise<Client | null> {
    const fresh = this.client && this.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS;
    if (fresh) return Promise.resolve(this.client);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<Client | null> {
    await this.close();
    let transport: StdioClientTransport | undefined;
    try {
      // The child only ever receives a short-lived sandbox access token, never the secret.
      const { token, expiresAt } = await this.opts.rest.getAccessToken();
      transport = new StdioClientTransport({
        command: this.opts.launch.command,
        args: [
          ...this.opts.launch.args,
          '--tools=orders.create,orders.get',
          '--paypal-environment=SANDBOX',
        ],
        env: { ...this.opts.extraEnv, PAYPAL_ACCESS_TOKEN: token, PAYPAL_ENVIRONMENT: 'SANDBOX' },
        stderr: 'pipe',
      });
      // The stdio stream is never logged verbatim; drain it so the child cannot block.
      transport.stderr?.on('data', () => undefined);

      const client = new Client({ name: 'intentlock-gateway', version: '0.1.0' });
      await client.connect(transport, { timeout: MCP_STARTUP_TIMEOUT_MS });
      const { tools } = await client.listTools(undefined, { timeout: MCP_STARTUP_TIMEOUT_MS });
      const names = new Set(tools.map((t) => t.name));
      const missing = ALLOWED_TOOLS.filter((t) => !names.has(t));
      if (missing.length > 0) {
        this.opts.logger.error({ missing }, 'PayPal MCP server lacks required tools');
        await client.close().catch(() => undefined);
        return null;
      }
      const extra = [...names].filter((n) => !(ALLOWED_TOOLS as readonly string[]).includes(n));
      if (extra.length > 0) {
        this.opts.logger.warn(
          { extra },
          'PayPal MCP server exposes extra tools; they stay blocked',
        );
      }
      client.onclose = () => {
        if (this.client === client) {
          this.client = null;
          this.opts.logger.warn('PayPal MCP server connection closed');
        }
      };
      this.client = client;
      this.tokenExpiresAt = expiresAt;
      this.opts.logger.info({ tools: ALLOWED_TOOLS }, 'PayPal MCP server connected');
      return client;
    } catch (e) {
      this.opts.logger.error(
        { err: e instanceof Error ? e.message : 'unknown' },
        'PayPal MCP server failed to start',
      );
      await transport?.close().catch(() => undefined);
      return null;
    }
  }

  /**
   * Single choke point for every MCP tool call. The allow-list is enforced before anything is
   * sent, and the result is Zod-validated by the caller-supplied schema.
   */
  async invokeTool<T>(
    name: string,
    args: Record<string, unknown>,
    schema: { parse: (v: unknown) => T },
  ): Promise<T> {
    if (!(ALLOWED_TOOLS as readonly string[]).includes(name)) throw new ToolNotAllowedError(name);
    const client = await this.ensureConnected();
    if (!client) throw new McpUnavailableError('MCP server not connected');

    let result: Awaited<ReturnType<Client['callTool']>>;
    try {
      result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: this.timeoutMs,
      });
    } catch (e) {
      if (e instanceof McpError && e.code === ErrorCode.RequestTimeout) {
        throw new UpstreamError('paypal_mcp', 'timeout', 'PayPal MCP tool call timed out');
      }
      throw new UpstreamError('paypal_mcp', 'error', 'PayPal MCP tool call failed');
    }
    return parseToolResult(result, schema);
  }

  /** MCP-only create (no fallback). */
  async mcpCreateOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    return this.invokeTool('create_order', buildCreateOrderArgs(input), CreatedOrderSchema);
  }

  /** MCP-only read (no fallback). */
  async mcpGetOrder(orderId: string): Promise<PayPalOrder> {
    return this.invokeTool('get_order', { id: orderId }, PayPalOrderSchema);
  }

  async createOrder(input: CreateOrderInput): Promise<GatewayCall<CreatedOrder>> {
    const started = this.now();
    try {
      const data = await this.mcpCreateOrder(input);
      return { data, trace: this.trace('create_order', 'mcp', 'ok', started, false, data.id) };
    } catch (e) {
      // Fall back only when nothing was sent. After a send, a REST retry could create a second
      // order (the MCP create_order tool carries no invoice id or request id).
      if (!(e instanceof McpUnavailableError)) throw this.traced(e, 'create_order', started);
      this.opts.logger.warn({ mcpTool: 'create_order' }, 'MCP unavailable, using REST fallback');
      const rest = await this.opts.rest.createOrder(input, input.requestId);
      return {
        data: rest.data,
        httpStatus: rest.httpStatus,
        debugId: rest.debugId,
        trace: this.trace('create_order', 'rest', 'ok', started, true, rest.data.id, rest.debugId),
      };
    }
  }

  async getOrder(orderId: string): Promise<GatewayCall<PayPalOrder>> {
    const started = this.now();
    try {
      const data = await this.mcpGetOrder(orderId);
      return { data, trace: this.trace('get_order', 'mcp', 'ok', started, false, orderId) };
    } catch (e) {
      this.opts.logger.warn(
        { mcpTool: 'get_order', reason: e instanceof Error ? e.name : 'unknown' },
        'MCP get_order failed, using REST fallback',
      );
      const rest = await this.opts.rest.getOrder(orderId);
      return {
        data: rest.data,
        httpStatus: rest.httpStatus,
        debugId: rest.debugId,
        trace: this.trace('get_order', 'rest', 'ok', started, true, orderId, rest.debugId),
      };
    }
  }

  private traced(e: unknown, tool: ToolName, started: number): unknown {
    if (e instanceof UpstreamError) {
      this.opts.logger.warn(
        this.trace(tool, 'mcp', e.kind === 'timeout' ? 'timeout' : 'error', started, false),
        'mcp call failed',
      );
    }
    return e;
  }

  private trace(
    tool: ToolName,
    channel: 'mcp' | 'rest',
    status: McpTrace['status'],
    started: number,
    fallbackToRest: boolean,
    orderId?: string,
    debugId?: string,
  ): McpTrace {
    return {
      tool,
      channel,
      status,
      durationMs: this.now() - started,
      at: new Date(started).toISOString(),
      orderId,
      debugId,
      fallbackToRest,
    };
  }
}

/** MCP create_order takes JS numbers; this is the only place minor units become decimals. */
export function buildCreateOrderArgs(input: CreateOrderInput) {
  const unit = Number(formatUsd(input.unitAmountMinor));
  const total = Number(formatUsd(input.unitAmountMinor * BigInt(input.quantity)));
  return {
    currencyCode: 'USD',
    items: [
      {
        name: input.itemName.slice(0, ITEM_NAME_MAX),
        quantity: input.quantity,
        itemCost: unit,
        itemTotal: total,
      },
    ],
  };
}

function parseToolResult<T>(
  result: Awaited<ReturnType<Client['callTool']>>,
  schema: { parse: (v: unknown) => T },
): T {
  const malformed = () => new UpstreamError('paypal_mcp', 'error', 'PayPal MCP result invalid');
  if (result['isError']) throw malformed();
  const content = result['content'];
  const first = Array.isArray(content) ? (content[0] as { type?: string; text?: unknown }) : null;
  if (!first || first.type !== 'text' || typeof first.text !== 'string') throw malformed();
  try {
    // PayPal API failures arrive as {"error":{...}} text, which fails schema validation below.
    return schema.parse(JSON.parse(first.text));
  } catch {
    throw malformed();
  }
}
