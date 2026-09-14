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
    ],
    query: { refetchInterval: 20_000 },
  });
  const offerCount = counts.data?.[0]?.status === 'success' ? Number(counts.data[0].result) : 0;
  const saleCount = counts.data?.[1]?.status === 'success' ? Number(counts.data[1].result) : 0;

  const book = useReadContracts({
    contracts: [
      ...Array.from({ length: offerCount }, (_, i) => ({ ...MARKET, functionName: 'getOffer', args: [BigInt(i)] })),
      ...Array.from({ length: saleCount }, (_, i) => ({ ...MARKET, functionName: 'getSale', args: [BigInt(i)] })),
    ],
    query: { enabled: offerCount + saleCount > 0, refetchInterval: 20_000 },
  });

  const { offers, sales } = useMemo(() => {
    const rows = book.data || [];
    const offers = rows.slice(0, offerCount).map((r, i) => (r.status === 'success' ? { id: i, ...r.result } : null)).filter(Boolean);
    const sales = rows.slice(offerCount).map((r, i) => (r.status === 'success' ? { id: i, ...r.result } : null)).filter(Boolean);
    for (const s of sales) s.offer = offers.find((o) => o.id === Number(s.offerId));
    return { offers, sales };
  }, [book.data, offerCount]);

  return {
    offers,
    sales,
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
