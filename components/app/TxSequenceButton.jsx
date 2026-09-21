'use client';

import TxButton from './TxButton';

/**
 * An action that needs several contract calls: claiming both buckets of a rung, withdrawing several claims. BNB Chain
 * cannot bundle them, and a wallet only opens reliably for the user's own tap, so this sends the first one and then
 * re-reads the chain: whatever is still outstanding comes back as the next tap. Nothing is remembered in the page, so
 * a reload — or a wallet browser reloading it for you — picks up exactly where you left off.
 */
export default function TxSequenceButton({ requests = [], label, restLabel, disabled, onDone, className = 'btn' }) {
  const total = requests.length;
  if (total === 0) return null;

  return (
    <span className="tx tx-steps">
      <TxButton
        className={className}
        disabled={disabled}
        label={total > 1 ? `${label} — 1 of ${total}` : (restLabel ?? label)}
        request={requests[0]}
        onDone={onDone}
      />
      {total > 1 && (
        <span className="muted small">
          {total} transactions, one tap each: confirm this one and the next tap appears right here.
        </span>
      )}
    </span>
  );
}
