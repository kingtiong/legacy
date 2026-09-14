// Today's prices, refreshed at most hourly. If CoinGecko is unreachable the page
// still renders, using the last prices checked by hand.
const FALLBACK = { eth: 2510, bnb: 722.74, asOf: '2026-09-10T00:00:00Z', live: false };

export async function getTodayPrices() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum&vs_currencies=usd&include_last_updated_at=true',
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const d = await res.json();
    const eth = d?.ethereum?.usd;
    const bnb = d?.binancecoin?.usd;
    if (!(eth > 0 && bnb > 0)) throw new Error('CoinGecko returned no price');
    const at = Math.max(d.ethereum.last_updated_at || 0, d.binancecoin.last_updated_at || 0);
    return { eth, bnb, asOf: new Date(at * 1000).toISOString(), live: true };
  } catch (err) {
    console.error('[prices] falling back to stored prices:', err.message);
    return FALLBACK;
  }
}

export { aboutUsd } from './format';
