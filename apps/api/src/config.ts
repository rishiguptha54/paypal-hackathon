import { z } from 'zod';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

const PLACEHOLDER = 'REPLACE_ME';

const secret = (min = 1) =>
  z
    .string()
    .min(min)
    .refine((v) => !v.includes(PLACEHOLDER), `still the ${PLACEHOLDER} placeholder`);

// Empty strings (e.g. `KEY=` in .env) are treated as unset.
const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && (v.trim() === '' || v.includes(PLACEHOLDER)) ? undefined : v),
  z.string().optional(),
);

const boolish = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: secret().refine(
      (v) => /^postgres(ql)?:\/\//.test(v),
      'must be a postgres:// or postgresql:// URL',
    ),
    SESSION_SECRET: secret(32),
    PAYPAL_CLIENT_ID: secret(),
    PAYPAL_CLIENT_SECRET: secret(),
    // The hackathon guard: any other value, including "live", stops the boot.
    PAYPAL_ENV: z.literal('sandbox', { error: 'must be exactly "sandbox"' }),
    PAYPAL_MCP_COMMAND: optionalText,
    PAYPAL_WEBHOOK_ID: optionalText,
    AI_PROVIDER: z.enum(['gemini', 'rule']).default('rule'),
    AI_API_KEY: optionalText,
    AI_MODEL: optionalText,
    PRODUCT_SOURCE: z.enum(['channel3', 'fixture']).default('fixture'),
    CHANNEL3_API_KEY: optionalText,
    APPROVAL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    POLICY_VERSION: z.string().min(1).default('v1'),
    STUDIO_AGENT_ENABLED: boolish,
    DEMO_CONTROLS_ENABLED: boolish,
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'gemini' && !env.AI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_API_KEY'],
        message: 'required when AI_PROVIDER=gemini',
      });
    }
  });

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  paypal: { clientId: string; clientSecret: string; env: 'sandbox'; mcpCommand?: string };
  aiProvider: 'gemini' | 'rule';
  aiApiKey?: string;
  aiModel: string;
  productSource: 'channel3' | 'fixture';
  channel3ApiKey?: string;
  approvalTtlSeconds: number;
  policyVersion: string;
  studioAgentEnabled: boolean;
  demoControlsEnabled: boolean;
};

/** Fails fast. Messages carry variable names and reasons, never values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    paypal: {
      clientId: e.PAYPAL_CLIENT_ID,
      clientSecret: e.PAYPAL_CLIENT_SECRET,
      env: e.PAYPAL_ENV,
      mcpCommand: e.PAYPAL_MCP_COMMAND,
    },
    aiProvider: e.AI_PROVIDER,
    aiApiKey: e.AI_API_KEY,
    aiModel: e.AI_MODEL ?? 'gemini-3.8-flash',
    productSource: e.PRODUCT_SOURCE,
    channel3ApiKey: e.CHANNEL3_API_KEY,
    approvalTtlSeconds: e.APPROVAL_TTL_SECONDS,
    policyVersion: e.POLICY_VERSION,
    studioAgentEnabled: e.STUDIO_AGENT_ENABLED,
    demoControlsEnabled: e.DEMO_CONTROLS_ENABLED,
  };
}
