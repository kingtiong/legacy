'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import WalletGate from './WalletGate';
import TxButton from './TxButton';
import TxSequenceButton from './TxSequenceButton';
import {
  VAULT, useVaultStats, usePositions, useClaims, useChainTime,
  maturityOf, cohortStart, bnb, day, month, timeLeft, parseAmount, sharesFor,
} from '../../lib/vaultHooks';
import { formatEther } from 'viem';
import { RETIREMENT, EMERGENCY, FEE_SHARES_ID, TEST_MODE } from '../../lib/protocol';

export default function Dashboard() {
  return (
    <>
      <header className="apphead">
        <p className="eyebrow">My ladder</p>
        <h1 className="h1-page">Every month you saved, and when it comes back</h1>
      </header>
      <WalletGate>
        <Ladder />
      </WalletGate>
    </>
  );
}

function Ladder() {
  const { address } = useAccount();
  const { stats, refetch: refetchStats, error } = useVaultStats();
  const [now, refetchTime] = useChainTime();
  const { positions, refetch: refetchPositions, isLoading } = usePositions(address, stats);
  const { claims, refetch: refetchClaims } = useClaims(address);

  const refresh = () => {
    refetchTime();
    refetchStats();
    refetchPositions();
    refetchClaims();
  };

  const rungs = useMemo(() => {
    const byCohort = new Map();
    for (const p of positions) {
      if (p.isFee) continue;
      const r = byCohort.get(p.cohort) || { cohort: p.cohort, [RETIREMENT]: null, [EMERGENCY]: null };
      r[p.bucket] = p;
      byCohort.set(p.cohort, r);
    }
    return [...byCohort.values()].sort((a, b) => a.cohort - b.cohort);
  }, [positions]);
  const fee = positions.find((p) => p.isFee);

  if (error) return <div className="panel app-empty"><p className="formmsg err">Could not reach BNB Chain. Refresh to try again.</p></div>;
  if (!stats || now == null) return <div className="panel app-empty"><p className="muted">Reading the vault…</p></div>;

  const total = positions.reduce((sum, p) => sum + (p.value ?? 0n), 0n);
  const next = rungs.find((r) => maturityOf(stats, r.cohort) > now);
  const open = claims.filter((c) => !c.withdrawn);

  return (
    <div className="appstack">
      <section className="tiles" aria-label="Summary">
        <div className="tile"><span className="k">Your ladder is worth</span><span className="v tnum">{bnb(total)}</span></div>
        <div className="tile"><span className="k">Months saved</span><span className="v tnum">{rungs.length}</span></div>
        <div className="tile">
          <span className="k">Next rung unlocks</span>
          <span className="v tnum">{next ? month(maturityOf(stats, next.cohort)) : '—'}</span>
        </div>
        <div className="tile"><span className="k">Whole pool</span><span className="v tnum">{bnb(stats.totalAssets, 2)}</span></div>
      </section>

      {open.length > 0 && <Claims claims={open} now={now} onDone={refresh} />}

      <section className="panel">
        <div className="panel-head">
          <h2 className="h3">Your rungs</h2>
          <Link className="btn sm" href="/app/deposit">Deposit this month</Link>
        </div>
        {isLoading && rungs.length === 0 ? (
          <p className="muted">Reading your shares…</p>
        ) : rungs.length === 0 && !fee ? (
          <div className="app-none">
            <p className="muted">No deposits yet. Your first deposit becomes the first rung of your ladder.</p>
          </div>
        ) : (
          <ul className="rungs-list">
            {rungs.map((r) => (
              <Rung key={r.cohort} rung={r} stats={stats} now={now} onDone={refresh} />
            ))}
            {fee && (
              <li className="rung">
                <div className="rung-when"><b>Protocol fee</b><span>Claimable any time</span></div>
                <div className="rung-buckets">
                  <Bucket title="Fee shares" position={fee} id={FEE_SHARES_ID} claimable onDone={refresh} />
                </div>
              </li>
            )}
          </ul>
        )}
      </section>

      <StakeIdle stats={stats} onDone={refresh} />
    </div>
  );
}

function Rung({ rung, stats, now, onDone }) {
  const matures = maturityOf(stats, rung.cohort);
  const matured = now >= matures;
  return (
    <li className={`rung${matured ? ' is-matured' : ''}`}>
      <div className="rung-when">
        <b>{month(cohortStart(stats, rung.cohort))}</b>
        <span>{matured ? `Matured ${day(matures)}` : `Unlocks ${day(matures)} · in ${timeLeft(matures, now)}`}</span>
      </div>
      <div className="rung-buckets">
        {matured && rung[RETIREMENT] && rung[EMERGENCY] && (
          <div className="bucket bucket-all">
            <span className="k">Whole rung</span>
            <span className="v tnum">{bnb((rung[RETIREMENT].value ?? 0n) + (rung[EMERGENCY].value ?? 0n))}</span>
            <TxSequenceButton
              className="btn sm"
              label="Claim whole rung"
              doneLabel="Claimed"
              requests={[rung[RETIREMENT], rung[EMERGENCY]].map((p) => ({
                ...VAULT,
                functionName: 'requestClaim',
                args: [p.id, p.shares],
              }))}
              onDone={onDone}
            />
            <span className="muted small">Or claim part of one bucket below.</span>
          </div>
        )}
        {rung[RETIREMENT] && (
          <Bucket title="Retirement" position={rung[RETIREMENT]} id={rung[RETIREMENT].id} claimable={matured} onDone={onDone} />
        )}
        {rung[EMERGENCY] && (
          <Bucket title="Emergency" position={rung[EMERGENCY]} id={rung[EMERGENCY].id} claimable={matured} onDone={onDone}
            sellable={!matured} cohort={rung.cohort} />
        )}
      </div>
    </li>
  );
}

function Bucket({ title, position, id, claimable, sellable, cohort, onDone }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const wanted = text === '' ? position.value : parseAmount(text);
  const shares = sharesFor(wanted, position);
  const tooMuch = wanted != null && position.value != null && wanted > position.value;

  return (
    <div className="bucket">
      <span className="k">{title}</span>
      <span className="v tnum">{bnb(position.value)}</span>
      {claimable && !open && (
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>Claim</button>
      )}
      {sellable && (
        <Link className="btn ghost sm" href={`/app/market?cohort=${cohort}`}>Sell my 30%</Link>
      )}
      {claimable && open && (
        <div className="claimbox">
          <label className="sr" htmlFor={`claim-${id}`}>BNB to claim</label>
          <div className="row">
            <input id={`claim-${id}`} type="text" inputMode="decimal" placeholder={`All (${bnb(position.value)})`}
              value={text} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="btn ghost sm"
              onClick={() => setText(position.value != null ? formatEther(position.value) : '')}>
              All
            </button>
          </div>
          {tooMuch && <span className="tx-error">That is more than this bucket holds.</span>}
          <TxButton
            className="btn sm"
            label="Claim BNB"
            doneLabel="Claimed"
            disabled={!shares || tooMuch}
            request={{ ...VAULT, functionName: 'requestClaim', args: [id, shares] }}
            onDone={() => {
              setOpen(false);
              setText('');
              onDone();
            }}
          />
        </div>
      )}
    </div>
  );
}

function Claims({ claims, now, onDone }) {
  return (
    <section className="panel panel-brass" aria-label="Claims">
      <h2 className="h3">Claims</h2>
      <p className="muted small">
        Claimed BNB is paid straight away when the vault has it idle. Otherwise it is unstaked from BNB Chain first,
        which takes about 7 days.
      </p>
      {claims.filter((c) => now >= Number(c.readyAt)).length > 1 && (
        <div className="cta-row" style={{ marginBottom: '.8rem' }}>
          <TxSequenceButton
            className="btn sm"
            label="Withdraw all ready"
            doneLabel="Paid"
            requests={claims
              .filter((c) => now >= Number(c.readyAt))
              .map((c) => ({ ...VAULT, functionName: 'withdraw', args: [BigInt(c.id)] }))}
            onDone={onDone}
          />
        </div>
      )}
      <ul className="claims-list">
        {claims.map((c) => {
          const ready = now >= Number(c.readyAt);
          return (
            <li key={c.id} className="claim">
              <span className="v tnum">{bnb(c.amount)}</span>
              <span className="muted">{ready ? 'Ready to withdraw' : `Ready in ${timeLeft(Number(c.readyAt), now)} · ${day(Number(c.readyAt))}`}</span>
              <TxButton className="btn sm" label="Withdraw to my wallet" doneLabel="Paid" disabled={!ready}
                request={{ ...VAULT, functionName: 'withdraw', args: [BigInt(c.id)] }} onDone={onDone} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Anyone may stake the vault's idle BNB once at least 1 BNB is waiting; it costs only gas. */
function StakeIdle({ stats, onDone }) {
  // Hidden in the test edition: staking would make every tester's claim wait 7 days for BNB Chain to unstake.
  if (TEST_MODE || stats.delegatableBnb < 10n ** 18n) return null;
  return (
    <section className="panel stake-idle">
      <div>
        <h2 className="h3">{bnb(stats.delegatableBnb, 2)} is waiting to be staked</h2>
        <p className="muted small">
          Deposits earn once they are staked with a validator. Anyone can trigger it; you only pay the network fee.
        </p>
      </div>
      <TxButton className="btn ghost sm" label="Stake it now" doneLabel="Staked" request={{ ...VAULT, functionName: 'flush' }} onDone={onDone} />
    </section>
  );
}
