'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';

export function shortAddress(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

export default function ConnectButton({ size = '' }) {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injectedConnector = connectors.find((c) => c.id === 'injected') ?? connectors[0];
  // Browser wallets inject window.ethereum. Ordinary phone browsers (Chrome, Safari) have none, so there the page has
  // to be reopened inside a wallet app's own browser. Checked after mount so server and client render the same.
  const [env, setEnv] = useState({ checked: false, provider: true, mobile: false, href: '' });
  useEffect(() => {
    setEnv({
      checked: true,
      provider: Boolean(window.ethereum) || injectedConnector?.type === 'mock',
      mobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
      href: window.location.href,
    });
  }, [injectedConnector]);

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

  if (env.checked && !env.provider) {
    if (env.mobile) {
      const bare = env.href.replace(/^https?:\/\//, '');
      return (
        <div className="wallet-help">
          <span className="muted small">Open this page inside your wallet app to connect:</span>
          <div className="row">
            <a className={`btn ${size}`} href={`https://metamask.app.link/dapp/${bare}`}>Open in MetaMask</a>
            <a className={`btn ghost ${size}`} href={`https://link.trustwallet.com/open_url?coin_id=20000714&url=${encodeURIComponent(env.href)}`}>
              Open in Trust Wallet
            </a>
          </div>
        </div>
      );
    }
    return (
      <a className={`btn ghost ${size}`} href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install a wallet
      </a>
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
