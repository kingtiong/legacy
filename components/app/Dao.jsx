'use client';

import { useState } from 'react';
import { encodeFunctionData, isAddress } from 'viem';
import { useAccount } from 'wagmi';
import WalletGate from './WalletGate';
import TxButton from './TxButton';
import { shortAddress } from '../ConnectButton';
import { VAULT, useChainTime, useClaims, bnb, day, timeLeft, parseAmount, sharesFor } from '../../lib/vaultHooks';
import { GOVERNOR, SUPPORT, useDao, useProposals } from '../../lib/daoHooks';
import { EXPLORER, FEE_SHARES_ID, TREASURY_ADDRESS, VAULT_ADDRESS } from '../../lib/protocol';

const TABS = [
  ['proposals', 'Proposals'],
  ['new', 'New proposal'],
  ['treasury', 'Treasury'],
];

export default function Dao() {
  return (
    <>
      <header className="apphead">
        <p className="eyebrow">DAO</p>
        <h1 className="h1-page">Depositors decide what the fees are for</h1>
        <p className="lead">
          The protocol’s 30% of staking rewards goes to a treasury only depositors can direct. Your vote is your
          ladder: one vote per share, counted as it stood when each proposal was made. No vote can ever touch
          anyone’s deposit.
        </p>
      </header>
      <WalletGate>
        <Board />
      </WalletGate>
    </>
  );
}

function Board() {
  const { address } = useAccount();
  const [now, refetchTime] = useChainTime();
  const { dao, refetch: refetchDao, error } = useDao(address);
  const { proposals, refetch: refetchProposals, isLoading } = useProposals(address, dao?.proposalCount ?? 0);
  const [tab, setTab] = useState('proposals');

  const refresh = () => {
    refetchTime();
    refetchDao();
    refetchProposals();
  };

  if (error) return <div className="panel app-empty"><p className="formmsg err">Could not reach BNB Chain. Refresh to try again.</p></div>;
  if (!dao || now == null) return <div className="panel app-empty"><p className="muted">Reading the DAO…</p></div>;

  const share = dao.totalVotes > 0n ? Number((dao.votes * 10000n) / dao.totalVotes) / 100 : 0;

  return (
    <div className="appstack">
      <section className="tiles" aria-label="DAO summary">
        <div className="tile"><span className="k">Treasury fee shares</span><span className="v tnum">{bnb(dao.feeValue)}</span></div>
        <div className="tile"><span className="k">Treasury BNB</span><span className="v tnum">{bnb(dao.bnbHeld)}</span></div>
        <div className="tile"><span className="k">Your voting power</span><span className="v tnum">{share.toLocaleString('en-US')}%</span></div>
        <div className="tile"><span className="k">Quorum</span><span className="v tnum">{dao.quorumPercent}% of votes</span></div>
      </section>

      <div className="toggle tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-pressed={tab === key} aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'proposals' &&
        (isLoading && dao.proposalCount > 0 ? (
          <div className="panel app-empty"><p className="muted">Reading proposals…</p></div>
        ) : proposals.length === 0 ? (
          <div className="panel app-empty">
            <h3>No proposals yet</h3>
            <p className="muted">Any depositor with a ladder worth about {bnb(dao.thresholdBnb, 2)} can make the first one.</p>
          </div>
        ) : (
          <ul className="proposals">
            {proposals.map((p) => <Proposal key={String(p.id)} p={p} now={now} dao={dao} onDone={refresh} />)}
          </ul>
        ))}
      {tab === 'new' && <NewProposal dao={dao} onDone={() => { refresh(); setTab('proposals'); }} />}
      {tab === 'treasury' && <Treasury dao={dao} now={now} onDone={refresh} />}
    </div>
  );
}

// ------------------------------------------------------------------ one proposal

function Proposal({ p, now, dao, onDone }) {
  const cast = p.forVotes + p.against + p.abstain;
  const pct = (x) => (cast > 0n ? Number((x * 1000n) / cast) / 10 : 0);
  const quorumReached = p.quorum != null && p.forVotes + p.abstain >= p.quorum;
  const idArg = [p.id];

  return (
    <li className="panel proposal">
      <div className="proposal-head">
        <span className={`pill state-${p.stateName.toLowerCase()}`}>{p.stateName}</span>
        <span className="muted small">
          #{p.index + 1} by {shortAddress(p.proposer)}
          {p.stateName === 'Active' && ` · voting ends in ${timeLeft(p.deadline, now)}`}
          {p.stateName === 'Queued' && (now >= p.eta ? ' · ready to execute' : ` · executable in ${timeLeft(p.eta, now)}`)}
        </span>
      </div>
      <h2 className="h3">{p.title}</h2>
      {p.body && <p className="muted proposal-body">{p.body}</p>}

      <ul className="actions-list">
        {p.actions.map((a, i) => (
          <li key={i}>
            <b>{a.text}</b>
            {a.shares != null && dao.feeShares && dao.feeValue != null && (
              <> worth about {bnb((a.shares * dao.feeValue) / dao.feeShares)} today</>
            )}
            {a.to && (
              <> to <a href={`${EXPLORER}/address/${a.to}`} target="_blank" rel="noreferrer">{shortAddress(a.to)}</a></>
            )}
          </li>
        ))}
      </ul>

      <div className="tally" aria-label="Votes">
        <div className="bar"><i className="for" style={{ width: `${pct(p.forVotes)}%` }} /><i className="against" style={{ width: `${pct(p.against)}%` }} /></div>
        <span className="small">For {pct(p.forVotes)}% · Against {pct(p.against)}% · Abstain {pct(p.abstain)}%</span>
        <span className="small muted">
          {p.quorum == null ? '' : quorumReached ? 'Quorum reached' : `Quorum: ${Number((((p.forVotes + p.abstain) * 1000n) / (p.quorum || 1n))) / 10}% of the way`}
        </span>
      </div>

      {p.stateName === 'Active' && (
        p.hasVoted ? (
          <p className="formmsg ok">You voted on this proposal.</p>
        ) : p.myWeight === 0n ? (
          <p className="muted small">You held no shares when this proposal was made, so you have no vote on it.</p>
        ) : (
          <div className="cta-row">
            <TxButton key="for" className="btn sm" label="Vote for" request={{ ...GOVERNOR, functionName: 'castVote', args: [p.id, SUPPORT.FOR] }} onDone={onDone} />
            <TxButton key="against" className="btn ghost sm" label="Vote against" request={{ ...GOVERNOR, functionName: 'castVote', args: [p.id, SUPPORT.AGAINST] }} onDone={onDone} />
            <TxButton key="abstain" className="btn ghost sm" label="Abstain" request={{ ...GOVERNOR, functionName: 'castVote', args: [p.id, SUPPORT.ABSTAIN] }} onDone={onDone} />
          </div>
        )
      )}
      {p.stateName === 'Succeeded' && (
        <div className="cta-row">
          <TxButton key="queue" className="btn sm" label="Queue in the timelock" request={{ ...GOVERNOR, functionName: 'queue', args: idArg }} onDone={onDone} />
          <span className="muted small">Starts the 2-day wait before anyone can carry it out.</span>
        </div>
      )}
      {p.stateName === 'Queued' && (
        <div className="cta-row">
          <TxButton key="execute" className="btn sm" label="Execute" disabled={now < p.eta} request={{ ...GOVERNOR, functionName: 'execute', args: idArg }} onDone={onDone} />
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ new proposal

const TEMPLATES = [
  ['grant', 'Grant fee shares', 'Give someone fee shares worth an amount of BNB. They can redeem them for BNB at any time.'],
  ['send', 'Send treasury BNB', 'Send BNB the treasury already holds (from fee shares it redeemed).'],
  ['redeem', 'Redeem fee shares', 'Turn the treasury’s fee shares into BNB held by the treasury.'],
];

function NewProposal({ dao, onDone }) {
  const { address } = useAccount();
  const [kind, setKind] = useState('grant');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [amountText, setAmountText] = useState('');
  const [to, setTo] = useState('');

  const amount = parseAmount(amountText);
  const treasuryPosition = { shares: dao.feeShares ?? 0n, value: dao.feeValue ?? 0n };
  const shares = sharesFor(amount, treasuryPosition);
  const canPropose = dao.votes != null && dao.votes >= dao.threshold;

  let problem = '';
  if (!canPropose) problem = `Making a proposal needs a ladder worth about ${bnb(dao.thresholdBnb, 2)}. You can still vote on every proposal made while you hold shares.`;
  else if (amountText && amount == null) problem = 'Enter an amount like 0.5';
  else if (kind !== 'redeem' && to && !isAddress(to)) problem = 'That address is not valid.';
  else if (kind === 'send' && amount != null && dao.bnbHeld != null && amount > dao.bnbHeld) problem = `The treasury holds ${bnb(dao.bnbHeld)}.`;
  else if (kind !== 'send' && amount != null && dao.feeValue != null && amount > dao.feeValue) problem = `The treasury’s fee shares are worth ${bnb(dao.feeValue)}.`;

  let action = null;
  if (amount && !problem && title.trim()) {
    if (kind === 'send' && isAddress(to)) action = { target: to, value: amount, data: '0x' };
    if (kind === 'grant' && isAddress(to) && shares > 0n) {
      action = { target: VAULT_ADDRESS, value: 0n, data: encodeFunctionData({ abi: VAULT.abi, functionName: 'safeTransferFrom', args: [TREASURY_ADDRESS, to, FEE_SHARES_ID, shares, '0x'] }) };
    }
    if (kind === 'redeem' && shares > 0n) {
      action = { target: VAULT_ADDRESS, value: 0n, data: encodeFunctionData({ abi: VAULT.abi, functionName: 'requestClaim', args: [FEE_SHARES_ID, shares] }) };
    }
  }
  const description = `# ${title.trim()}\n\n${body.trim()}`;

  return (
    <div className="deposit-grid">
      <section className="panel">
        <div className="field">
          <label>What should the treasury do?</label>
          <div className="toggle toggle-wrap">
            {TEMPLATES.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}>{label}</button>
            ))}
          </div>
          <p className="hint">{TEMPLATES.find(([k]) => k === kind)[2]}</p>
        </div>
        <div className="field">
          <label htmlFor="p-amount">Amount</label>
          <div className="row">
            <input id="p-amount" type="text" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            <span className="unit">BNB</span>
          </div>
          <p className="hint">Treasury: fee shares worth {bnb(dao.feeValue)}, plus {bnb(dao.bnbHeld)} held.</p>
        </div>
        {kind !== 'redeem' && (
          <div className="field">
            <label htmlFor="p-to">Recipient</label>
            <input id="p-to" type="text" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} autoComplete="off" spellCheck="false" />
          </div>
        )}
        <div className="field">
          <label htmlFor="p-title">Title</label>
          <input id="p-title" type="text" placeholder="Fund an independent audit" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="p-body">Why (optional)</label>
          <textarea id="p-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000}
            placeholder="What the money is for, who receives it, and how depositors can check the result." />
        </div>
        {problem && <p className="formmsg err">{problem}</p>}
      </section>

      <section className="panel summary">
        <h2 className="h3">How it goes</h2>
        <dl className="kv">
          <div><dt>Voting</dt><dd>Opens immediately, runs {Math.round(dao.votingPeriod / 86400)} days</dd></div>
          <div><dt>Passes if</dt><dd>More for than against, and at least {dao.quorumPercent}% of all votes take part</dd></div>
          <div><dt>Then</dt><dd>Waits 2 days in the timelock, then anyone can execute it</dd></div>
          <div><dt>Proposer</dt><dd>{shortAddress(address)}</dd></div>
        </dl>
        <p className="notice">
          Proposals are public and permanent. The vote can only move treasury funds; it can never touch a
          depositor’s shares.
        </p>
        <TxButton
          className="btn lg"
          label="Publish proposal"
          disabled={!action}
          request={action ? { ...GOVERNOR, functionName: 'propose', args: [[action.target], [action.value], [action.data], description] } : null}
          onDone={onDone}
        />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ treasury

function Treasury({ dao, now, onDone }) {
  const { claims, refetch } = useClaims(TREASURY_ADDRESS);
  const open = claims.filter((c) => !c.withdrawn);
  return (
    <section className="panel">
      <h2 className="h3">Treasury</h2>
      <dl className="kv">
        <div><dt>Address</dt><dd><a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer">{TREASURY_ADDRESS}</a></dd></div>
        <div><dt>Fee shares</dt><dd className="tnum">{bnb(dao.feeValue)}</dd></div>
        <div><dt>BNB</dt><dd className="tnum">{bnb(dao.bnbHeld)}</dd></div>
        <div><dt>Controlled by</dt><dd>Depositor votes only, through a 2-day timelock. No admin.</dd></div>
      </dl>
      {open.length > 0 && (
        <>
          <h3 className="h3">Redemptions on the way</h3>
          <ul className="claims-list">
            {open.map((c) => {
              const ready = now >= Number(c.readyAt);
              return (
                <li key={c.id} className="claim">
                  <span className="v tnum">{bnb(c.amount)}</span>
                  <span className="muted">{ready ? 'Ready: anyone can pay it into the treasury' : `Ready in ${timeLeft(Number(c.readyAt), now)} · ${day(Number(c.readyAt))}`}</span>
                  <TxButton className="btn sm" label="Pay into treasury" doneLabel="Paid" disabled={!ready}
                    request={{ ...VAULT, functionName: 'withdraw', args: [BigInt(c.id)] }} onDone={() => { refetch(); onDone(); }} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
