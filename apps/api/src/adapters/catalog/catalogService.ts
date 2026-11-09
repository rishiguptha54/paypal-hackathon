import { UpstreamError } from '../../errors';
import type { CatalogProvider, CatalogSearchResult } from './types';
import type { Logger } from '../../logger';
import type { FixtureCatalogProvider } from './fixtureCatalogProvider';

export class CatalogService {
  private failedOver = false;

  constructor(
    private readonly active: CatalogProvider,
    private readonly fixtures: FixtureCatalogProvider,
    private readonly logger: Logger,
  ) {}

  async search(query: string, limit = 20): Promise<CatalogSearchResult> {
    if (this.active === this.fixtures) return this.fixtures.search(query, limit);
    try {
      const result = await this.active.search(query, limit);
      this.failedOver = false;
      return result;
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      this.failedOver = true;
      this.logger.warn(
        { provider: 'channel3', kind: e.kind },
        'Channel3 search failed; falling back to fixtures',
      );
      return this.fixtures.search(query, limit);
    }
  }

  merchantPresets(): string[] {
    const activePresets = this.active.merchantPresets();
    return activePresets.length > 0 ? activePresets : this.fixtures.merchantPresets();
  }

  status() {
    return this.failedOver ? 'degraded' : this.active.status();
  }
}
