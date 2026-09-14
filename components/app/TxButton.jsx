'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CHAIN_ID, EXPLORER } from '../../lib/protocol';
import { explainError } from '../../lib/txErrors';

/**
 * One contract write. Simulates first, so a transaction that would fail explains itself before the wallet opens,
 * then shows each state in plain words and calls onDone once BNB Chain confirms it.
 */
export default function TxButton({ request, label, doneLabel, disabled, onDone, className = 'btn' }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });
  const [checking, setChecking] = useState(false);
  const [simError, setSimError] = useState(null);
  const notified = useRef(null);

  useEffect(() => {
    if (receipt.isSuccess && hash && notified.current !== hash) {
      notified.current = hash;
      onDone?.(receipt.data);
    }
  }, [receipt.isSuccess, receipt.data, hash, onDone]);

  async function send() {
    reset();
    setSimError(null);
    setChecking(true);
    try {
      const { request: prepared } = await client.simulateContract({ ...request, account: address, chainId: CHAIN_ID });
      writeContract(prepared);
    } catch (e) {
      setSimError(e);
    } finally {
      setChecking(false);
    }
  }

  const reverted = receipt.data && receipt.data.status !== 'success';
  const busy = checking || isPending || receipt.isLoading;
  const text = checking
    ? 'Checking…'
    : isPending
      ? 'Confirm in your wallet…'
      : receipt.isLoading
        ? 'Waiting for BNB Chain…'
        : receipt.isSuccess && !reverted && doneLabel
          ? doneLabel
          : label;
  const failure = simError || writeError || receipt.error;

  return (
    <span className="tx">
      <button type="button" className={className} disabled={disabled || busy || !request || !address} onClick={send}>
        {text}
      </button>
      {hash && (
        <a className="tx-link" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
      {(failure || reverted) && (
        <span className="tx-error" role="alert">
          {reverted ? 'The transaction failed on-chain.' : explainError(failure)}
        </span>
      )}
    </span>
  );
}
