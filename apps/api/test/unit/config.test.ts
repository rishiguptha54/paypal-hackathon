import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(32),
  PAYPAL_CLIENT_ID: 'client-id-value',
  PAYPAL_CLIENT_SECRET: 'client-secret-value',
  PAYPAL_ENV: 'sandbox',
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env as NodeJS.ProcessEnv);
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
}

describe('UNIT-CFG-01 config', () => {
  it('accepts a complete sandbox config and applies defaults', () => {
    const c = loadConfig(valid as NodeJS.ProcessEnv);
    expect(c.paypal.env).toBe('sandbox');
    expect(c.port).toBe(3000);
    expect(c.approvalTtlSeconds).toBe(900);
    expect(c.demoControlsEnabled).toBe(false);
  });

  it.each(['live', 'production', 'Sandbox', ''])('refuses to boot when PAYPAL_ENV=%j', (v) => {
    expect(problems({ ...valid, PAYPAL_ENV: v }).join()).toMatch(/PAYPAL_ENV/);
  });

  it('refuses to boot when PAYPAL_ENV is missing', () => {
    expect(problems({ ...valid, PAYPAL_ENV: undefined }).join()).toMatch(/PAYPAL_ENV/);
  });

  it.each(['DATABASE_URL', 'SESSION_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'])(
    'fails fast when %s is missing',
    (key) => {
      expect(problems({ ...valid, [key]: undefined }).join()).toContain(key);
    },
  );

  it('rejects <REPLACE_ME> placeholders and short session secrets', () => {
    expect(problems({ ...valid, PAYPAL_CLIENT_SECRET: '<REPLACE_ME>' }).join()).toMatch(
      /PAYPAL_CLIENT_SECRET/,
    );
    expect(problems({ ...valid, SESSION_SECRET: 'short' }).join()).toMatch(/SESSION_SECRET/);
  });

  it('rejects non-postgres database URLs', () => {
    expect(problems({ ...valid, DATABASE_URL: 'mysql://x' }).join()).toMatch(/DATABASE_URL/);
  });

  it('never echoes secret values in error messages', () => {
    const msg = problems({
      ...valid,
      SESSION_SECRET: 'tooShortSecretValue',
      PAYPAL_ENV: 'live',
    }).join();
    expect(msg).not.toContain('tooShortSecretValue');
    expect(msg).not.toContain('client-secret-value');
  });

  it('treats empty optional values as unset', () => {
    const c = loadConfig({
      ...valid,
      PAYPAL_MCP_COMMAND: '',
      AI_API_KEY: '<REPLACE_ME>',
    } as NodeJS.ProcessEnv);
    expect(c.paypal.mcpCommand).toBeUndefined();
  });
});
