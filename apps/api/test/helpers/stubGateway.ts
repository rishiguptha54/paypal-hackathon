import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PayPalMcpGateway } from '../../src/adapters/paypalMcp/gateway';
import type { PayPalRestClient } from '../../src/adapters/paypal/client';
import { formatUsd } from '../../src/core/money';
import { createLogger } from '../../src/logger';
import type { FakePayPal } from './fakePaypal';

const STUB = fileURLToPath(new URL('../fixtures/stubMcpServer.mjs', import.meta.url));

export function stubGateway(
  rest: PayPalRestClient,
  fake: FakePayPal,
  ordersFile: string,
  extraEnv: Record<string, string> = {},
) {
  writeFileSync(ordersFile, '{}');
  fake.onOrderChange = () =>
    writeFileSync(ordersFile, JSON.stringify(Object.fromEntries(fake.orders)));
  const gateway = new PayPalMcpGateway({
    rest,
    launch: { command: process.execPath, args: [STUB] },
    logger: createLogger({ level: 'silent' }),
    extraEnv: { ...extraEnv, STUB_ORDERS_FILE: ordersFile },
  });
  const create = gateway.createOrder.bind(gateway);
  gateway.createOrder = async (input) => {
    const call = await create(input);
    fake.orders.set(call.data.id, {
      total: formatUsd(input.unitAmountMinor * BigInt(input.quantity)),
      status: 'CREATED',
    });
    fake.onOrderChange?.();
    return call;
  };
  return gateway;
}
