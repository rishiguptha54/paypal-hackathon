import { createHash } from 'node:crypto';
import { z } from 'zod';
import { UpstreamError } from '../../errors';
import { normalizeOffer, type RawOffer } from '../../core/normalizeOffer';
import type { CatalogProvider, CatalogSearchResult } from './types';

export const CHANNEL3_SEARCH_URL = 'https://api.trychannel3.com/v1/search';
export const CHANNEL3_TIMEOUT_MS = 4_000;
export const CATALOG_CACHE_TTL_MS = 10 * 60_000;
export const CATALOG_CACHE_MAX_ENTRIES = 100;

const ProductBrandSchema = z.object({ name: z.string().optional() }).passthrough();
const PriceSchema = z
  .object({ price: z.number().finite().nonnegative(), currency: z.string() })
  .passthrough();
const ProductOfferSchema = z
  .object({
    url: z.string(),
    domain: z.string(),
    price: PriceSchema,
    availability: z.string().optional(),
  })
  .passthrough();
const ProductSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    brands: z.array(ProductBrandSchema).optional(),
    offers: z.array(ProductOfferSchema).optional(),
  })
  .passthrough();
const SearchResponseSchema = z.object({ products: z.array(z.unknown()) }).passthrough();

interface CacheEntry {
  expiresAt: number;
  result: CatalogSearchResult;
}

export class Channel3CatalogProvider implements CatalogProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly merchantDomains = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly options: {
      apiKey?: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
      now?: () => number;
    },
  ) {
    this.now = options.now ?? Date.now;
  }

  async search(query: string, limit = 20): Promise<CatalogSearchResult> {
    if (!this.options.apiKey)
      throw new UpstreamError('channel3', 'error', 'Channel3 API key missing');
    const boundedLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
    const key = `${query.trim().toLowerCase().replace(/\s+/g, ' ')}|${boundedLimit}`;
    const now = this.now();
    for (const [cachedKey, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(cachedKey);
    }
    const cached = this.cache.get(key);
    if (cached) return cached.result;

    const fetchFn = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(CHANNEL3_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.options.apiKey,
        },
        body: JSON.stringify({ query, limit: boundedLimit }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? CHANNEL3_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new UpstreamError(
        'channel3',
        timedOut ? 'timeout' : 'error',
        timedOut ? 'Channel3 request timed out' : 'Channel3 request failed',
      );
    }
    if (!response.ok) {
      throw new UpstreamError(
        'channel3',
        response.status === 504 ? 'timeout' : 'error',
        `Channel3 returned HTTP ${response.status}`,
        { httpStatus: response.status },
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new UpstreamError('channel3', 'error', 'Channel3 returned invalid JSON');
    }
    const parsed = SearchResponseSchema.safeParse(json);
    if (!parsed.success)
      throw new UpstreamError('channel3', 'error', 'Channel3 response was invalid');

    const offers: CatalogSearchResult['offers'] = [];
    for (const rawProduct of parsed.data.products) {
      const product = ProductSchema.safeParse(rawProduct);
      if (!product.success) continue;
      const data = product.data;
      const brand = data.brands?.[0]?.name;
      const productOffers = data.offers?.length ? data.offers : [undefined];
      for (const offer of productOffers) {
        if (offers.length >= boundedLimit) break;
        const validOffer = offer ? ProductOfferSchema.safeParse(offer) : null;
        if (offer && !validOffer?.success) continue;
        const merchantOffer = validOffer?.success ? validOffer.data : undefined;
        const raw: RawOffer = {
          id: data.id,
          title: data.title,
          description: data.description,
          brand,
          domain: merchantOffer?.domain,
          url: merchantOffer?.url,
          price: merchantOffer?.price,
        };
        const normalized = normalizeOffer(raw);
        if (!normalized.offerUrl || !normalized.merchantDomain) continue;
        this.merchantDomains.add(normalized.merchantDomain);
        offers.push({ ...normalized, rawSha256: rawProductSha256(rawProduct) });
      }
      if (offers.length >= boundedLimit) break;
    }

    const result = { source: 'channel3' as const, offers };
    this.cache.set(key, { result, expiresAt: this.now() + CATALOG_CACHE_TTL_MS });
    while (this.cache.size > CATALOG_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return result;
  }

  merchantPresets(): string[] {
    return [...this.merchantDomains].sort();
  }

  status() {
    return this.options.apiKey ? ('ok' as const) : ('degraded' as const);
  }
}

export function rawProductSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
