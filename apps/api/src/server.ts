import { PayPalRestClient } from './adapters/paypal/client';
import { PayPalMcpGateway, defaultMcpLaunch } from './adapters/paypalMcp/gateway';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { createLogger } from './logger';
import { WEB_DIST_DIR } from './paths';
import { createPgDb } from './repo/db';
import { RuleBasedParser } from './adapters/intentParser/ruleBasedParser';
import { GeminiIntentParser } from './adapters/intentParser/geminiParser';
import { FixtureCatalogProvider } from './adapters/catalog/fixtureCatalogProvider';
import { Channel3CatalogProvider } from './adapters/catalog/channel3CatalogProvider';
import { CatalogService } from './adapters/catalog/catalogService';

async function main() {
  const logger = createLogger();

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    // Variable names and reasons only; never the values.
    logger.fatal(
      { problems: e instanceof ConfigError ? e.problems : ['unknown'] },
      'invalid config',
    );
    process.exit(1);
  }

  const { db, close } = createPgDb(config.databaseUrl);
  const rest = new PayPalRestClient({
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
    logger,
  });
  const gateway = new PayPalMcpGateway({
    rest,
    launch: defaultMcpLaunch(config.paypal.mcpCommand),
    logger,
  });
  const parser =
    config.aiProvider === 'gemini'
      ? new GeminiIntentParser({
          apiKey: requireAiApiKey(config.aiApiKey),
          model: config.aiModel,
          logger,
        })
      : new RuleBasedParser();
  const fixtures = new FixtureCatalogProvider();
  const channel3 = new Channel3CatalogProvider({ apiKey: config.channel3ApiKey });
  const catalog = new CatalogService(
    config.productSource === 'channel3' ? channel3 : fixtures,
    fixtures,
    logger,
  );
  await gateway.start();

  const app = createApp({
    config,
    db,
    logger,
    rest,
    gateway,
    parser,
    catalog,
    webDistDir: WEB_DIST_DIR,
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.paypal.env }, 'IntentLock API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void gateway
        .close()
        .then(close)
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();

function requireAiApiKey(value: string | undefined): string {
  if (!value) throw new Error('AI_API_KEY is required when AI_PROVIDER=gemini.');
  return value;
}
