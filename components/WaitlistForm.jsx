'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import ConnectButton, { shortAddress } from './ConnectButton';

export default function WaitlistForm() {
  const { address, isConnected } = useAccount();
  const [email, setEmail] = useState('');
  const [chain, setChain] = useState('bnb');
  const [monthly, setMonthly] = useState(1);
  const [state, setState] = useState({ status: 'idle', message: '' });

  async function onSubmit(e) {
    e.preventDefault();
    setState({ status: 'sending', message: '' });
    try {
      const res = await fetch('/project21/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, chain, monthly: Number(monthly), wallet: address || '' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ status: 'error', message: data.error || 'Something went wrong.' });
        return;
      }
      setState({
        status: 'done',
        message: address
          ? `Saved. We have your address ${shortAddress(address)} on the list.`
          : 'Saved. Connect a wallet any time to add your address.',
      });
    } catch {
      setState({ status: 'error', message: 'Network error. Please try again.' });
    }
  }

  if (state.status === 'done') {
    return (
      <div className="panel">
        <h3 style={{ marginBottom: '.5rem' }}>You&rsquo;re signed up</h3>
        <p className="muted" style={{ fontSize: '.92rem', margin: 0 }}>
          {state.message} We&rsquo;ll write only when something matters: audit results, DAO votes and risks you should know about.
        </p>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="wl-email">Email</label>
        <input
          id="wl-email"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="wl-chain-bnb">Which asset would you contribute?</label>
        <div className="toggle">
          <button id="wl-chain-bnb" type="button" aria-pressed={chain === 'bnb'} onClick={() => setChain('bnb')}>
            BNB
          </button>
          <button type="button" aria-pressed={chain === 'eth'} onClick={() => setChain('eth')}>
            ETH
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="wl-monthly">Roughly how much each month?</label>
        <div className="row">
          <input
            id="wl-monthly"
            type="number"
            min="0"
            step="0.1"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
          <span className="unit">{chain.toUpperCase()}</span>
        </div>
      </div>

      <div className="field">
        <label>Wallet {isConnected ? '' : '(optional)'}</label>
        <ConnectButton size="sm" />
      </div>

      <button className="btn" type="submit" disabled={state.status === 'sending'} style={{ width: '100%' }}>
        {state.status === 'sending' ? 'Saving…' : 'Get updates'}
      </button>

      {state.status === 'error' && <p className="formmsg err">{state.message}</p>}
    </form>
  );
}
