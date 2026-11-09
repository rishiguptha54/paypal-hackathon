import type { NormalizedOffer } from '../../core/normalizeOffer';

export type CatalogSource = 'channel3' | 'fixture';
export interface CatalogSearchResult {
  source: CatalogSource;
  offers: NormalizedOffer[];
}

export interface CatalogProvider {
  search(query: string, limit?: number): Promise<CatalogSearchResult>;
  merchantPresets(): string[];
  status(): 'ok' | 'degraded' | 'down';
}
