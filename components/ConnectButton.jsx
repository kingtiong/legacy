'use client';

import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';

export function shortAddress(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

export default function ConnectButton({ size = '' }) {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injectedConnector = connectors.find((c) => c.id === 'injected') ?? connectors[0];

  if (isConnected) {
    return (
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="wallet-chip">
          <span className="dot" aria-hidden="true" />
          {shortAddress(address)}
          {chain ? <span className="chip-chain"> · {chain.name}</span> : null}
        </span>
        <button className={`btn ghost disconnect ${size}`} onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  if (!injectedConnector) {
    return (
      <a className={`btn ghost ${size}`} href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install a wallet
      </a>
    );
  }

  return (
    <button
      className={`btn ${size}`}
      onClick={() => connect({ connector: injectedConnector })}
      disabled={isPending}
    >
      {isPending ? 'Check your wallet…' : 'Connect wallet'}
    </button>
  );
}

export function useWalletBalance() {
  const { address, isConnected } = useAccount();
  const { data } = useBalance({ address, query: { enabled: isConnected } });
  return data;
}
