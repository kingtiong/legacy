'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import Link from 'next/link';
import ConnectButton from '../ConnectButton';
import { LIVE, CHAIN_ID } from '../../lib/protocol';

/** Shows children only when the protocol is live, a wallet is connected, and it is on BNB Smart Chain. */
export default function WalletGate({ children, title = 'Connect your wallet' }) {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!LIVE) {
    return (
      <div className="panel app-empty">
        <h3>Launching soon</h3>
        <p className="muted">The contracts are not deployed yet. Join the waitlist to hear the moment they are.</p>
        <Link className="btn" href="/waitlist">Join the waitlist</Link>
      </div>
    );
  }
  if (!isConnected) {
    return (
      <div className="panel app-empty">
        <h3>{title}</h3>
        <p className="muted">Your ladder lives in your wallet. Nothing is stored anywhere else.</p>
        <ConnectButton />
      </div>
    );
  }
  if (chainId !== CHAIN_ID) {
    return (
      <div className="panel app-empty">
        <h3>Switch to BNB Smart Chain</h3>
        <p className="muted">Decadium runs on BNB Smart Chain only.</p>
        <button className="btn" type="button" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
          {isPending ? 'Check your wallet…' : 'Switch network'}
        </button>
      </div>
    );
  }
  return children;
}
