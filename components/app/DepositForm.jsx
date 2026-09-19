'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAccount, useBalance } from 'wagmi';
import WalletGate from './WalletGate';
import TxButton from './TxButton';
import DepositTerms from './DepositTerms';
import { VAULT, useVaultStats, useChainTime, maturityOf, cohortStart, bnb, day, month, parseAmount } from '../../lib/vaultHooks';
import { CHAIN_ID, DEPOSITS_PAUSED, TEST_MODE, EXPLORER, VAULT_ADDRESS } from '../../lib/protocol';

// Every deposit is split 70% retirement / 30% emergency; depositors do not choose.
const RETIREMENT_BPS = 7_000;
const GAS_BUFFER = 10n ** 15n; // 0.001 BNB left for network fees

export default function DepositForm() {
  return (
    <>
      <header className="apphead">
        <p className="eyebrow">Deposit</p>
        <h1 className="h1-page">Add this month’s rung</h1>
        <p className="lead">
          {TEST_MODE ? 'Test edition: each deposit is locked for 10 hours instead of ten years.' : 'Each deposit is locked for ten years.'} 70% goes to retirement, which nobody can touch. The other 30% is
          your emergency bucket, which you can sell to another person if life happens.
        </p>
      </header>
      {DEPOSITS_PAUSED ? (
        <div className="panel app-empty paused">
          <h3>Deposits are paused for a security upgrade</h3>
          <p className="muted">
            A pre-audit security review found an issue in the current contracts that could freeze withdrawals. No
            deposits have been made, so no one’s money is affected. We are fixing it in a new version and will
            reopen deposits once it is deployed and tested.
          </p>
          <p className="muted small">Please do not send BNB to the current vault address directly.</p>
        </div>
      ) : (
        <WalletGate>
          <Form />
        </WalletGate>
      )}
    </>
  );
}

function Form() {
  const { address } = useAccount();
  const { stats, refetch } = useVaultStats();
  const [now] = useChainTime();
  const balance = useBalance({ address, chainId: CHAIN_ID, query: { refetchInterval: 30_000 } });
  const [text, setText] = useState('');
  const [stage, setStage] = useState('form'); // form -> review -> done
  const [lang, setLang] = useState('en');
  const [done, setDone] = useState(null);

  if (!stats || now == null) return <div className="panel app-empty"><p className="muted">Reading the vault…</p></div>;

  const amount = parseAmount(text);
  const cohort = stats.currentCohort;
  const unlocks = maturityOf(stats, cohort);
  const toA = amount ? (amount * BigInt(RETIREMENT_BPS)) / 10_000n : 0n;
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
        <p className="muted">{bnb(done.amount)} is locked in the vault until <b>{day(done.unlocks)}</b>.</p>
        {done.hash && (
          <p className="small">
            <a href={`${EXPLORER}/tx/${done.hash}`} target="_blank" rel="noreferrer">See the transaction on BscScan ↗</a>
          </p>
        )}
        <div className="cta-row">
          <Link className="btn" href="/app">See my ladder</Link>
          <button type="button" className="btn ghost" onClick={() => { setDone(null); setText(''); setStage('form'); }}>
            Deposit again
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'review' && amount && !problem) {
    return (
      <DepositTerms amount={amount} toA={toA} toB={toB} unlocks={unlocks} stats={stats}
        account={address} lang={lang} setLang={setLang} onBack={() => setStage('form')}
        onAccept={(accepted) => (
          <TxButton
            className="btn lg"
            label={lang === 'zh' ? `确认并锁定 ${bnb(amount)}` : `Confirm and lock ${bnb(amount)}`}
            disabled={!accepted}
            request={{ ...VAULT, functionName: 'deposit', args: [address, BigInt(RETIREMENT_BPS)], value: amount }}
            onDone={(receipt) => {
              setDone({ amount, cohort, unlocks, hash: receipt?.transactionHash });
              refetch();
              balance.refetch();
            }}
          />
        )}
      />
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
          <label>Split (fixed)</label>
          <p className="split-fixed"><b>70% retirement</b> · <b>30% emergency</b></p>
          <p className="hint">Every deposit is split the same way. Retirement can never be sold or moved before it unlocks. Emergency can only be sold, through the market.</p>
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
        <p className="notice">
          Locked for {TEST_MODE ? '10 years (10 hours in this test edition)' : '10 years'}. Only the emergency part can
          be sold early, to another person for USDT or USDC, usually at a discount. The full rules come next.
        </p>
        <button type="button" className="btn lg" disabled={!amount || Boolean(problem)} onClick={() => { setStage('review'); window.scrollTo(0, 0); }}>
          {amount ? `Review terms for ${bnb(amount)}` : 'Enter an amount'}
        </button>
        <div className="vault-box">
          <span className="k">Your BNB goes to the Decadium vault</span>
          <span className="vault-addr">{VAULT_ADDRESS}</span>
          <span className="vault-links">
            <a className="btn ghost sm" href={`${EXPLORER}/address/${VAULT_ADDRESS}`} target="_blank" rel="noreferrer">View on BscScan ↗</a>
            <a className="btn ghost sm" href={`https://repo.sourcify.dev/56/${VAULT_ADDRESS}`} target="_blank" rel="noreferrer">Verified on Sourcify ↗</a>
          </span>
        </div>
      </section>
    </div>
  );
}
