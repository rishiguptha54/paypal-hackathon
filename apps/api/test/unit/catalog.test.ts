import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Channel3CatalogProvider,
  CHANNEL3_SEARCH_URL,
  CATALOG_CACHE_MAX_ENTRIES,
  CATALOG_CACHE_TTL_MS,
} from '../../src/adapters/catalog/channel3CatalogProvider';
import { CatalogService } from '../../src/adapters/catalog/catalogService';
import { FixtureCatalogProvider } from '../../src/adapters/catalog/fixtureCatalogProvider';
import { createLogger } from '../../src/logger';
import { UpstreamError } from '../../src/errors';

const logger = createLogger({ level: 'silent' });

describe('FixtureCatalogProvider', () => {
  it('returns capped fictional fixtures covering policy scenarios', async () => {
    const provider = new FixtureCatalogProvider();
    const result = await provider.search('desk chair', 20);
    expect(result.source).toBe('fixture');
    expect(result.offers).toHaveLength(7);
    expect(result.offers.some((item) => item.recurrenceSignal === 'RECURRING')).toBe(true);
    expect(result.offers.some((item) => item.recurrenceSignal === 'AMBIGUOUS')).toBe(true);
    expect(result.offers.some((item) => item.unitAmountMinor === null)).toBe(true);
  });
});

describe('Channel3CatalogProvider', () => {
  const product = {
    id: 'item-1',
    title: 'Desk chair',
    brands: [{ name: 'Seatwell' }],
    offers: [
      {
        url: 'https://shop.example.com/chair',
        domain: 'shop.example.com',
        price: { price: 89.5, currency: 'USD' },
      },
      {
        url: 'http://bad.example/chair',
        domain: 'bad.example',
        price: { price: 1, currency: 'USD' },
      },
    ],
  };

  it('maps verified response fields, drops malformed offers, and hashes raw product data', async () => {
    let callCount = 0;
    let requestUrl: Parameters<typeof fetch>[0] | undefined;
    let requestInit: RequestInit | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      callCount += 1;
      requestUrl = input;
      requestInit = init;
      return Response.json({ products: [product, { title: 'malformed' }] });
    };
    const provider = new Channel3CatalogProvider({ apiKey: 'channel-test', fetch });
    const result = await provider.search('desk chair', 20);
    expect(callCount).toBe(1);
    expect(requestUrl).toBe(CHANNEL3_SEARCH_URL);
    expect(requestInit?.headers).toMatchObject({ 'x-api-key': 'channel-test' });
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.unitAmountMinor).toBe('8950');
    expect(result.offers[0]?.merchantDomain).toBe('shop.example.com');
    expect(result.offers[0]?.rawSha256).toBe(
      createHash('sha256').update(JSON.stringify(product)).digest('hex'),
    );
    expect(provider.merchantPresets()).toEqual(['shop.example.com']);
  });

  it('caps results at 20 and caches for ten minutes', async () => {
    let now = 0;
    let callCount = 0;
    const fetch: typeof globalThis.fetch = async () => {
      callCount += 1;
      return Response.json({ products: [product] });
    };
    const provider = new Channel3CatalogProvider({ apiKey: 'channel-test', fetch, now: () => now });
    await provider.search('same query', 100);
    await provider.search(' SAME   QUERY ', 20);
    expect(callCount).toBe(1);
    now = CATALOG_CACHE_TTL_MS + 1;
    await provider.search('same query', 20);
    expect(callCount).toBe(2);
  });

  it('bounds cache growth and expires old queries', async () => {
    let now = 0;
    let callCount = 0;
    const fetch: typeof globalThis.fetch = async () => {
      callCount += 1;
      return Response.json({ products: [product] });
    };
    const provider = new Channel3CatalogProvider({ apiKey: 'channel-test', fetch, now: () => now });
    for (let index = 0; index <= CATALOG_CACHE_MAX_ENTRIES; index += 1) {
      await provider.search(`query-${index}`);
    }
    expect(callCount).toBe(CATALOG_CACHE_MAX_ENTRIES + 1);
    await provider.search('query-0');
    expect(callCount).toBe(CATALOG_CACHE_MAX_ENTRIES + 2);

    now = CATALOG_CACHE_TTL_MS + 1;
    await provider.search('query-1');
    expect(callCount).toBe(CATALOG_CACHE_MAX_ENTRIES + 3);
  });

  it('rejects missing keys and maps fetch failures to upstream errors', async () => {
    await expect(new Channel3CatalogProvider({}).search('desk')).rejects.toBeInstanceOf(
      UpstreamError,
    );
    const provider = new Channel3CatalogProvider({
      apiKey: 'channel-test',
      fetch: async () => {
        throw new DOMException('timeout', 'TimeoutError');
      },
    });
    await expect(provider.search('desk')).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('CatalogService', () => {
  it('falls back to fixtures and reports a degraded provider after Channel3 errors', async () => {
    const fixtures = new FixtureCatalogProvider();
    const channel3 = new Channel3CatalogProvider({
      apiKey: 'channel-test',
      fetch: async () => new Response('', { status: 503 }),
    });
    const service = new CatalogService(channel3, fixtures, logger);
    expect(service.merchantPresets()).toEqual(fixtures.merchantPresets());
    expect((await service.search('desk')).source).toBe('fixture');
    expect(service.status()).toBe('degraded');
    expect(service.merchantPresets()).toEqual(fixtures.merchantPresets());
  });

  it('uses fixture merchant presets until Channel3 has supplied active merchant domains', async () => {
    const fixtures = new FixtureCatalogProvider();
    let activePresets: string[] = [];
    const active = {
      search: async () => ({ source: 'channel3' as const, offers: [] }),
      merchantPresets: () => activePresets,
      status: () => 'ok' as const,
    };
    const service = new CatalogService(active, fixtures, logger);
    expect(service.merchantPresets()).toEqual(fixtures.merchantPresets());
    expect((await service.search('desk')).source).toBe('channel3');
    activePresets = ['shop.example.com'];
    expect(service.merchantPresets()).toEqual(['shop.example.com']);
  });
});
