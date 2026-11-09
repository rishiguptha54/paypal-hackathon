import { normalizeOffer, type RawOffer } from '../../core/normalizeOffer';
import type { CatalogProvider, CatalogSearchResult } from './types';

const FIXTURES: RawOffer[] = [
  {
    id: 'fixture-chair-basic',
    title: 'Ergonomic desk chair',
    brand: 'Seatwell',
    merchantName: 'Northstar Office',
    domain: 'northstar-office.example',
    url: 'https://northstar-office.example/products/ergonomic-chair',
    price: { value: '89.00', currency: 'USD' },
  },
  {
    id: 'fixture-chair-premium',
    title: 'Executive ergonomic chair',
    brand: 'Seatwell',
    merchantName: 'Northstar Office',
    domain: 'northstar-office.example',
    url: 'https://northstar-office.example/products/executive-chair',
    price: { value: '249.00', currency: 'USD' },
  },
  {
    id: 'fixture-chair-unapproved',
    title: 'Mesh office chair',
    brand: 'Airframe',
    merchantName: 'Unlisted Supply',
    domain: 'unlisted-supply.example',
    url: 'https://unlisted-supply.example/chair',
    price: { value: '75.00', currency: 'USD' },
  },
  {
    id: 'fixture-subscription',
    title: 'Office suite monthly subscription',
    description: 'Auto-renewing membership billed monthly.',
    brand: 'Paperkite',
    merchantName: 'Northstar Office',
    domain: 'northstar-office.example',
    url: 'https://northstar-office.example/subscription',
    price: { value: '12.00', currency: 'USD' },
  },
  {
    id: 'fixture-ambiguous-plan',
    title: 'Annual office protection plan',
    brand: 'Paperkite',
    merchantName: 'Northstar Office',
    domain: 'northstar-office.example',
    url: 'https://northstar-office.example/plan',
    price: { value: '39.00', currency: 'USD' },
  },
  {
    id: 'fixture-missing-price',
    title: 'Office chair with unverified price',
    brand: 'Seatwell',
    merchantName: 'Northstar Office',
    domain: 'northstar-office.example',
    url: 'https://northstar-office.example/products/unpriced-chair',
    price: 'unavailable',
  },
  {
    id: 'fixture-lookalike-domain',
    title: 'Office chair from a look-alike domain',
    brand: 'Seatwell',
    merchantName: 'Lookalike Shop',
    domain: 'northstar-office.example.unlisted-supply.example',
    url: 'https://northstar-office.example.unlisted-supply.example/chair',
    price: { value: '65.00', currency: 'USD' },
  },
];

export class FixtureCatalogProvider implements CatalogProvider {
  async search(_query: string, limit = 20): Promise<CatalogSearchResult> {
    return {
      source: 'fixture',
      offers: FIXTURES.slice(0, Math.min(20, Math.max(0, limit))).map(normalizeOffer),
    };
  }

  merchantPresets(): string[] {
    return [...new Set(FIXTURES.map((item) => item.domain).filter((d): d is string => !!d))].sort();
  }

  status() {
    return 'ok' as const;
  }
}

export { FIXTURES as FIXTURE_OFFERS };
