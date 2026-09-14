'use client';

import { useMemo } from 'react';
import { useBalance, useReadContracts } from 'wagmi';
import { decodeFunctionData, formatEther } from 'viem';
import governorAbi from './abi/LadderGovernor';
import { VAULT } from './vaultHooks';
import { CHAIN_ID, GOVERNOR_ADDRESS, TREASURY_ADDRESS, FEE_SHARES_ID, VAULT_ADDRESS } from './protocol';

export const GOVERNOR = { address: GOVERNOR_ADDRESS, abi: governorAbi, chainId: CHAIN_ID };

export const STATES = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];
export const SUPPORT = { AGAINST: 0, FOR: 1, ABSTAIN: 2 };

/** DAO settings, the treasury's holdings, and the account's current voting power. */
export function useDao(account) {
  const q = useReadContracts({
    contracts: [
      { ...GOVERNOR, functionName: 'proposalThreshold' },
      { ...GOVERNOR, functionName: 'votingPeriod' },
      { ...GOVERNOR, functionName: 'quorumNumerator' },
      { ...GOVERNOR, functionName: 'proposalCount' },
      { ...VAULT, functionName: 'balanceOf', args: [TREASURY_ADDRESS, FEE_SHARES_ID] },
      { ...VAULT, functionName: 'getVotes', args: [account] },
      { ...VAULT, functionName: 'totalSupply' },
      { ...VAULT, functionName: 'totalSupply', args: [FEE_SHARES_ID] },
    ],
    query: { enabled: Boolean(account), refetchInterval: 20_000 },
  });
  const r = (i) => (q.data?.[i]?.status === 'success' ? q.data[i].result : null);
  const feeShares = r(4);
  const values = useReadContracts({
    contracts: [
      { ...VAULT, functionName: 'previewRedeem', args: [feeShares ?? 0n] },
      { ...VAULT, functionName: 'previewRedeem', args: [r(0) ?? 0n] },
    ],
    query: { enabled: feeShares != null, refetchInterval: 20_000 },
  });
  const bnbHeld = useBalance({ address: TREASURY_ADDRESS, chainId: CHAIN_ID, query: { refetchInterval: 20_000 } });

  const ready = q.data && q.data.slice(0, 8).every((x) => x.status === 'success');
  return {
    dao: ready
      ? {
          threshold: r(0),
          thresholdBnb: values.data?.[1]?.result ?? null,
          votingPeriod: Number(r(1)),
          quorumPercent: Number(r(2)),
          proposalCount: Number(r(3)),
          feeShares,
          feeValue: values.data?.[0]?.result ?? null,
          bnbHeld: bnbHeld.data?.value ?? null,
          votes: r(5),
          totalVotes: r(6) - r(7),
        }
      : null,
    error: q.error,
    refetch: () => {
      q.refetch();
      values.refetch();
      bnbHeld.refetch();
    },
  };
}

/** Every proposal, newest first, with its state, tally and the account's part in it. */
export function useProposals(account, count) {
  const details = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({ ...GOVERNOR, functionName: 'proposalDetailsAt', args: [BigInt(i)] })),
    query: { enabled: count > 0 },
  });
  const ids = useMemo(
    () => (details.data || []).map((d) => (d.status === 'success' ? d.result[0] : null)).filter((x) => x != null),
    [details.data]
  );
  const PER = 8;
  const info = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...GOVERNOR, functionName: 'state', args: [id] },
      { ...GOVERNOR, functionName: 'proposalVotes', args: [id] },
      { ...GOVERNOR, functionName: 'proposalSnapshot', args: [id] },
      { ...GOVERNOR, functionName: 'proposalDeadline', args: [id] },
      { ...GOVERNOR, functionName: 'proposalEta', args: [id] },
      { ...GOVERNOR, functionName: 'proposalDescription', args: [id] },
      { ...GOVERNOR, functionName: 'proposalProposer', args: [id] },
      { ...GOVERNOR, functionName: 'hasVoted', args: [id, account] },
    ]),
    query: { enabled: ids.length > 0 && Boolean(account), refetchInterval: 20_000 },
  });
  const snapshots = ids.map((_, i) => info.data?.[i * PER + 2]?.result);
  const extra = useReadContracts({
    contracts: ids.flatMap((id, i) =>
      snapshots[i] == null
        ? []
        : [
            { ...GOVERNOR, functionName: 'quorum', args: [snapshots[i]] },
            { ...VAULT, functionName: 'getPastVotes', args: [account, snapshots[i]] },
          ]
    ),
    query: { enabled: snapshots.every((s) => s != null) && ids.length > 0, refetchInterval: 20_000 },
  });

  const proposals = useMemo(() => {
    if (!info.data) return [];
    return ids
      .map((id, i) => {
        const at = (k) => info.data[i * PER + k];
        if ([0, 1, 2, 3, 5, 6].some((k) => at(k)?.status !== 'success')) return null;
        const [against, forVotes, abstain] = at(1).result;
        const d = details.data[i].result;
        const text = at(5).result || '';
        const [title, ...rest] = text.split('\n');
        return {
          id,
          index: i,
          state: at(0).result,
          stateName: STATES[at(0).result],
          against,
          forVotes,
          abstain,
          snapshot: Number(at(2).result),
          deadline: Number(at(3).result),
          eta: Number(at(4)?.result ?? 0),
          title: title.replace(/^#\s*/, '') || 'Untitled proposal',
          body: rest.join('\n').trim(),
          proposer: at(6).result,
          hasVoted: at(7)?.result === true,
          quorum: extra.data?.[i * 2]?.result ?? null,
          myWeight: extra.data?.[i * 2 + 1]?.result ?? null,
          actions: d[1].map((target, k) => describeAction(target, d[2][k], d[3][k])),
        };
      })
      .filter(Boolean)
      .reverse();
  }, [ids, info.data, extra.data, details.data]);

  return {
    proposals,
    isLoading: details.isLoading || info.isLoading,
    refetch: () => {
      details.refetch();
      info.refetch();
      extra.refetch();
    },
  };
}

const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

/** A proposal action in plain words, falling back to the raw call. */
export function describeAction(target, value, data) {
  const bnbValue = value > 0n ? `${Number(formatEther(value)).toLocaleString('en-US', { maximumFractionDigits: 6 })} BNB` : '';
  if ((!data || data === '0x') && value > 0n) return { kind: 'send', text: `Send ${bnbValue}`, to: target };
  if (same(target, VAULT_ADDRESS)) {
    try {
      const call = decodeFunctionData({ abi: VAULT.abi, data });
      if (call.functionName === 'safeTransferFrom' && call.args[2] === FEE_SHARES_ID) {
        return { kind: 'grant', text: 'Grant fee shares', shares: call.args[3], to: call.args[1] };
      }
      if (call.functionName === 'requestClaim' && call.args[0] === FEE_SHARES_ID) {
        return { kind: 'redeem', text: 'Redeem fee shares into BNB for the treasury', shares: call.args[1] };
      }
      if (call.functionName === 'addValidator') return { kind: 'call', text: 'List a new validator', to: call.args[0], prep: ':' };
      if (call.functionName === 'removeValidator') return { kind: 'call', text: 'Remove a validator', to: call.args[0], prep: ':' };
      if (call.functionName === 'redelegate') {
        return { kind: 'call', text: `Move stake (${call.args[2]} credits, max 10% per week) from ${call.args[0].slice(0, 8)}… to`, to: call.args[1] };
      }
      return { kind: 'call', text: `Vault: ${call.functionName}(${call.args?.map(String).join(', ') ?? ''})`, to: target };
    } catch {
      // fall through to the raw call
    }
  }
  return { kind: 'call', text: `Call with data ${data.slice(0, 18)}…${bnbValue ? ` and ${bnbValue}` : ''}`, to: target };
}
