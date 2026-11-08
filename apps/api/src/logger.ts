import { pino, type Logger } from 'pino';

export type { Logger };

export const REDACT_PATHS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'client_secret',
  'access_token',
  'api_key',
  'payer.email_address',
  'payer.name',
  '*.authorization',
  '*.cookie',
  '*.set-cookie',
  '*.client_secret',
  '*.access_token',
  '*.api_key',
  '*.payer.email_address',
  '*.payer.name',
  '*.*.client_secret',
  '*.*.access_token',
  '*.*.api_key',
  '*.*.authorization',
  '*.*.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function createLogger(opts: { level?: string; destination?: pino.DestinationStream } = {}) {
  return pino(
    {
      level: opts.level ?? process.env['LOG_LEVEL'] ?? 'info',
      base: undefined,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    opts.destination,
  );
}
