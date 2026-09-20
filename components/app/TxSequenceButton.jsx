'use client';

import { useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { CHAIN_ID, EXPLORER } from '../../lib/protocol';
import { explainError } from '../../lib/txErrors';

/**
 * Several contract calls in a row, one wallet confirmation each: BNB Chain has no way to bundle them. Shows which
 * step it is on, stops at the first failure, and reports what already went through.
 */
export default function TxSequenceButton({ requests, label, doneLabel = 'Done', disabled, onDone, className = 'btn' }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { data: wallet } = useWalletClient({ chainId: CHAIN_ID });
  const [state, setState] = useState({ step: 0, busy: false, error: null, hash: null, done: false });
  const total = requests?.length ?? 0;

  async function run() {
    setState({ step: 0, busy: true, error: null, hash: null, done: false });
    for (let i = 0; i < total; i++) {
      setState((s) => ({ ...s, step: i, hash: null }));
      try {
        const { request } = await client.simulateContract({ ...requests[i], account: address, chainId: CHAIN_ID });
        const hash = await wallet.writeContract(request);
        setState((s) => ({ ...s, hash }));
        const receipt = await client.waitForTransactionReceipt({ hash, chainId: CHAIN_ID });
        if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
      } catch (e) {
        setState({ step: i, busy: false, error: e, hash: null, done: false });
        onDone?.();
        return;
      }
    }
    setState({ step: total, busy: false, error: null, hash: null, done: true });
    onDone?.();
  }

  const text = state.busy
    ? `Confirm ${state.step + 1} of ${total} in your wallet…`
    : state.done
      ? doneLabel
      : total > 1
        ? `${label} (${total} transactions)`
        : label;

  return (
    <span className="tx">
      <button type="button" className={className} disabled={disabled || state.busy || !total || !wallet} onClick={run}>
        {text}
      </button>
      {state.hash && (
        <a className="tx-link" href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>
      )}
      {state.error && (
        <span className="tx-error" role="alert">
          {state.step > 0 ? `Step ${state.step + 1} of ${total}: ` : ''}{explainError(state.error)}
        </span>
      )}
    </span>
  );
}
