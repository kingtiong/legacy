'use client';

import { useMemo } from 'react';
import { useBlock, useReadContracts } from 'wagmi';
import { formatEther, formatUnits, parseUnits } from 'viem';
import vaultAbi from './abi/LadderVault';
import marketAbi from './abi/CohortMarket';
import { VAULT_ADDRESS, MARKET_ADDRESS, CHAIN_ID, FEE_SHARES_ID, shareId, cohortOf, bucketOf } from './protocol';

const vault = { address: VAULT_ADDRESS, abi: vaultAbi, chainId: CHAIN_ID };
const market = { address: MARKET_ADDRESS, abi: marketAbi, chainId: CHAIN_ID };

export const VAULT = vault;
export const MARKET = market;

const STAT_FIELDS = [
  'GENESIS', 'EPOCH', 'LOCK_EPOCHS', 'MIN_DEPOSIT', 'MAX_DEPOSIT', 'currentCohort', 'depositCap', 'totalAssets',
  'totalSupply', 'sharePrice', 'stakedBnb', 'delegatableBnb', 'outstandingClaims', 'validators',
];

/** The chain's clock, not the browser's: statuses must match what the contracts will check. */
export function useChainTime() {
  const { data, refetch } = useBlock({ chainId: CHAIN_ID, query: { refetchInterval: 15_000 } });
  return [data ? Number(data.timestamp) : null, refetch];
}

/** Protocol-wide numbers, refreshed every 30 s. */
export function useVaultStats() {
  const q = useReadContracts({
    contracts: STAT_FIELDS.map((functionName) => ({ ...vault, functionName })),
    query: { refetchInterval: 30_000 },
  });
  const stats = useMemo(() => {
    if (!q.data || q.data.some((r) => r.status !== 'success')) return null;
    const s = Object.fromEntries(STAT_FIELDS.map((k, i) => [k, q.data[i].result]));
    const cap = s.depositCap;
    s.capRemaining = cap === 2n ** 256n - 1n ? null : cap > s.totalAssets ? cap - s.totalAssets : 0n;
    return s;
  }, [q.data]);
  return { stats, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
}

export const cohortStart = (stats, cohort) => Number(stats.GENESIS + BigInt(cohort) * stats.EPOCH);
export const maturityOf = (stats, cohort) =>
  Number(stats.GENESIS + (BigInt(cohort) + 1n + stats.LOCK_EPOCHS) * stats.EPOCH);

/** Every non-zero share balance the account holds, with its BNB value. */
export function usePositions(account, stats) {
  const ids = useMemo(() => {
    if (!stats) return [];
    const list = [FEE_SHARES_ID];
    for (let c = 0n; c <= stats.currentCohort; c++) list.push(shareId(c, 0), shareId(c, 1));
    return list;
  }, [stats]);

  const balances = useReadContracts({
    contracts: account && ids.length
      ? [{ ...vault, functionName: 'balanceOfBatch', args: [ids.map(() => account), ids] }]
      : [],
    query: { enabled: Boolean(account && ids.length), refetchInterval: 30_000 },
  });

  const held = useMemo(() => {
    const r = balances.data?.[0];
    if (!r || r.status !== 'success') return [];
    return ids.map((id, i) => ({ id, shares: r.result[i] })).filter((p) => p.shares > 0n);
  }, [balances.data, ids]);

  const values = useReadContracts({
    contracts: held.map((p) => ({ ...vault, functionName: 'previewRedeem', args: [p.shares] })),
    query: { enabled: held.length > 0, refetchInterval: 30_000 },
  });

  const positions = useMemo(
    () =>
      held.map((p, i) => ({
        ...p,
        isFee: p.id === FEE_SHARES_ID,
        cohort: p.id === FEE_SHARES_ID ? null : Number(cohortOf(p.id)),
        bucket: p.id === FEE_SHARES_ID ? null : bucketOf(p.id),
        value: values.data?.[i]?.status === 'success' ? values.data[i].result : null,
      })),
    [held, values.data]
  );

  return {
    positions,
    isLoading: balances.isLoading || values.isLoading,
    refetch: () => {
      balances.refetch();
      values.refetch();
    },
  };
}

/** Claims owned by the account, newest first. */
export function useClaims(account) {
  const count = useReadContracts({
    contracts: [{ ...vault, functionName: 'claimCount' }],
    query: { enabled: Boolean(account), refetchInterval: 30_000 },
  });
  const n = count.data?.[0]?.status === 'success' ? Number(count.data[0].result) : 0;
  const all = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({ ...vault, functionName: 'getClaim', args: [BigInt(i)] })),
    query: { enabled: n > 0, refetchInterval: 30_000 },
  });
  const claims = useMemo(() => {
    if (!all.data || !account) return [];
    return all.data
      .map((r, i) => (r.status === 'success' ? { id: i, ...r.result } : null))
      .filter((c) => c && c.owner.toLowerCase() === account.toLowerCase())
      .reverse();
  }, [all.data, account]);
  return {
    claims,
    refetch: () => {
      count.refetch();
      all.refetch();
    },
  };
}

// ---------------------------------------------------------------- formatting

/** Parse a typed decimal amount; null when empty or invalid. */
export function parseAmount(text, decimals = 18) {
  const t = String(text ?? '').trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  try {
    return parseUnits(t, decimals);
  } catch {
    return null;
  }
}

export function usd(value, decimals = 18, symbol = 'USDT') {
  if (value == null) return '—';
  const n = Number(formatUnits(value, decimals));
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol}`;
}

/** Shares of a position that are worth `wanted` BNB, capped at the whole position. */
export function sharesFor(wanted, position) {
  if (wanted == null || !position?.value) return 0n;
  if (wanted >= position.value) return position.shares;
  return (position.shares * wanted) / position.value;
}

export function bnb(wei, digits = 4) {
  if (wei == null) return '—';
  const n = Number(formatEther(wei));
  if (n !== 0 && Math.abs(n) < 10 ** -digits) return `< ${10 ** -digits} BNB`;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: digits })} BNB`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "14 Oct 2036", in UTC so server and client render the same text. */
export function day(ts) {
  const d = new Date(ts * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function month(ts) {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function timeLeft(ts, now = Math.floor(Date.now() / 1000)) {
  const s = ts - now;
  if (s <= 0) return 'now';
  const days = Math.floor(s / 86400);
  if (days >= 730) return `${Math.floor(days / 365)} years`;
  if (days >= 60) return `${Math.floor(days / 30)} months`;
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  if (s >= 3600) {
    const hours = Math.floor(s / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (s >= 120) return `${Math.floor(s / 60)} minutes`;
  return 'under a minute';
}
