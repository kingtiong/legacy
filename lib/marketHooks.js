'use client';

import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { MARKET, VAULT } from './vaultHooks';

/** Every offer and sale ever made. Fine for launch volumes; an indexer replaces this once there are thousands. */
export function useMarketBook() {
  const counts = useReadContracts({
    contracts: [
      { ...MARKET, functionName: 'offerCount' },
      { ...MARKET, functionName: 'saleCount' },
      { ...MARKET, functionName: 'listingCount' },
      { ...MARKET, functionName: 'COOLING_OFF' },
      { ...MARKET, functionName: 'TRADE_FEE_BPS' },
      { ...MARKET, functionName: 'CANCEL_FEE_BPS' },
    ],
    query: { refetchInterval: 20_000 },
  });
  const offerCount = counts.data?.[0]?.status === 'success' ? Number(counts.data[0].result) : 0;
  const saleCount = counts.data?.[1]?.status === 'success' ? Number(counts.data[1].result) : 0;
  // Markets deployed before listings existed have no listingCount; treat that as none.
  const listingCount = counts.data?.[2]?.status === 'success' ? Number(counts.data[2].result) : 0;
  const coolingOff = counts.data?.[3]?.status === 'success' ? Number(counts.data[3].result) : 7 * 24 * 3600;
  // Markets deployed before the fees existed answer neither call: nothing is charged there.
  const tradeFeeBps = counts.data?.[4]?.status === 'success' ? Number(counts.data[4].result) : 0;
  const cancelFeeBps = counts.data?.[5]?.status === 'success' ? Number(counts.data[5].result) : 0;

  const book = useReadContracts({
    contracts: [
      ...Array.from({ length: offerCount }, (_, i) => ({ ...MARKET, functionName: 'getOffer', args: [BigInt(i)] })),
      ...Array.from({ length: saleCount }, (_, i) => ({ ...MARKET, functionName: 'getSale', args: [BigInt(i)] })),
      ...Array.from({ length: listingCount }, (_, i) => ({ ...MARKET, functionName: 'getListing', args: [BigInt(i)] })),
    ],
    query: { enabled: offerCount + saleCount + listingCount > 0, refetchInterval: 20_000 },
  });

  const { offers, sales, listings } = useMemo(() => {
    const rows = book.data || [];
    const pick = (from, to) =>
      rows.slice(from, to).map((r, i) => (r.status === 'success' ? { id: i, ...r.result } : null)).filter(Boolean);
    const offers = pick(0, offerCount);
    const sales = pick(offerCount, offerCount + saleCount);
    const listings = pick(offerCount + saleCount, offerCount + saleCount + listingCount);
    for (const s of sales) s.offer = offers.find((o) => o.id === Number(s.offerId));
    return { offers, sales, listings };
  }, [book.data, offerCount, saleCount, listingCount]);

  return {
    offers,
    sales,
    listings,
    coolingOff,
    tradeFeeBps,
    cancelFeeBps,
    isLoading: counts.isLoading || book.isLoading,
    refetch: () => {
      counts.refetch();
      book.refetch();
    },
  };
}

/** BNB value of each share amount, in the same order. */
export function useValues(shareAmounts) {
  const q = useReadContracts({
    contracts: shareAmounts.map((s) => ({ ...VAULT, functionName: 'previewRedeem', args: [s] })),
    query: { enabled: shareAmounts.length > 0, refetchInterval: 30_000 },
  });
  return shareAmounts.map((_, i) => (q.data?.[i]?.status === 'success' ? q.data[i].result : null));
}

/** "7 days", "10 minutes": a cooling-off length in words. */
export function span(seconds) {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  return `${Math.round(seconds / 60)} minutes`;
}

/** What a fee of `bps` comes to on `amount`, rounded down exactly as the contract does. */
export function feeOn(amount, bps) {
  if (amount == null || !bps) return 0n;
  return (amount * BigInt(bps)) / 10_000n;
}
