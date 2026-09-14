'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAccount, useBalance } from 'wagmi';
import WalletGate from './WalletGate';
import TxButton from './TxButton';
import { VAULT, useVaultStats, useChainTime, maturityOf, cohortStart, bnb, day, month, parseAmount } from '../../lib/vaultHooks';
import { CHAIN_ID } from '../../lib/protocol';

const GAS_BUFFER = 10n ** 15n; // 0.001 BNB left for network fees

export default function DepositForm() {
  return (
    <>
      <header className="apphead">
        <p className="eyebrow">Deposit</p>
        <h1 className="h1-page">Add this month’s rung</h1>
        <p className="lead">
          Each deposit is locked for ten years. At least 70% goes to retirement, which nobody can touch. The rest is
          your emergency bucket, which you can sell to another person if life happens.
        </p>
      </header>
      <WalletGate>
        <Form />
      </WalletGate>
    </>
  );
}

function Form() {
  const { address } = useAccount();
  const { stats, refetch } = useVaultStats();
  const [now] = useChainTime();
  const balance = useBalance({ address, chainId: CHAIN_ID, query: { refetchInterval: 30_000 } });
  const [text, setText] = useState('');
  const [retirement, setRetirement] = useState(70);
  const [understood, setUnderstood] = useState(false);
  const [done, setDone] = useState(null);

  if (!stats || now == null) return <div className="panel app-empty"><p className="muted">Reading the vault…</p></div>;

  const amount = parseAmount(text);
  const cohort = stats.currentCohort;
  const unlocks = maturityOf(stats, cohort);
  const toA = amount ? (amount * BigInt(retirement)) / 100n : 0n;
  const toB = amount ? amount - toA : 0n;
  const wallet = balance.data?.value;

  let problem = '';
  if (text !== '' && amount == null) problem = 'Enter an amount like 0.5';
  else if (amount != null && amount < stats.MIN_DEPOSIT) problem = `The smallest deposit is ${bnb(stats.MIN_DEPOSIT)}.`;
  else if (amount != null && amount > stats.MAX_DEPOSIT) problem = `The largest single deposit during launch is ${bnb(stats.MAX_DEPOSIT)}.`;
  else if (amount != null && stats.capRemaining != null && amount > stats.capRemaining)
    problem = `The pool can take ${bnb(stats.capRemaining)} more this month. The limit rises every month.`;
  else if (amount != null && wallet != null && amount + GAS_BUFFER > wallet) problem = 'Not enough BNB in your wallet (keep a little for the network fee).';

  if (done) {
    return (
      <div className="panel app-empty">
        <h3>Your {month(cohortStart(stats, done.cohort))} rung is on the ladder</h3>
        <p className="muted">{bnb(done.amount)} locked until {day(done.unlocks)}.</p>
        <div className="cta-row">
          <Link className="btn" href="/app">See my ladder</Link>
          <button type="button" className="btn ghost" onClick={() => { setDone(null); setText(''); setUnderstood(false); }}>
            Deposit again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="deposit-grid">
      <section className="panel">
        <div className="field">
          <label htmlFor="amount">Amount</label>
          <div className="row">
            <input id="amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text}
              onChange={(e) => setText(e.target.value.replace(',', '.'))} />
            <span className="unit">BNB</span>
          </div>
          <p className="hint">
            In your wallet: {wallet != null ? bnb(wallet) : '—'} · Limits {bnb(stats.MIN_DEPOSIT, 2)} to {bnb(stats.MAX_DEPOSIT, 0)} per deposit
          </p>
        </div>
        <div className="field">
          <label htmlFor="split">
            Split <span className="rangeval">{retirement}% retirement · {100 - retirement}% emergency</span>
          </label>
          <input id="split" type="range" min="70" max="100" step="5" value={retirement}
            onChange={(e) => setRetirement(Number(e.target.value))} />
          <p className="hint">Retirement can never be sold or moved before it unlocks. Emergency can be sold, only through the market.</p>
        </div>
        {problem && <p className="formmsg err">{problem}</p>}
      </section>

      <section className="panel summary">
        <h2 className="h3">What happens</h2>
        <dl className="kv">
          <div><dt>Rung</dt><dd>{month(cohortStart(stats, cohort))}</dd></div>
          <div><dt>Retirement</dt><dd className="tnum">{bnb(toA)}</dd></div>
          <div><dt>Emergency</dt><dd className="tnum">{bnb(toB)}</dd></div>
          <div><dt>Unlocks</dt><dd>{day(unlocks)}</dd></div>
          <div><dt>Earns</dt><dd>70% of BNB Chain staking rewards, compounding</dd></div>
          <div><dt>Votes</dt><dd>One DAO vote per share, for as long as you hold it</dd></div>
        </dl>
        <label className="check">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>
            I understand this BNB is locked until <b>{day(unlocks)}</b>, that nobody (including the builders) can
            unlock it early, and that the contracts are new and have not been audited.
          </span>
        </label>
        <TxButton
          className="btn lg"
          label={amount ? `Lock ${bnb(amount)} for ten years` : 'Enter an amount'}
          disabled={!amount || Boolean(problem) || !understood}
          request={amount && !problem ? { ...VAULT, functionName: 'deposit', args: [address, BigInt(retirement * 100)], value: amount } : null}
          onDone={() => {
            setDone({ amount, cohort, unlocks });
            refetch();
            balance.refetch();
          }}
        />
      </section>
    </div>
  );
}
