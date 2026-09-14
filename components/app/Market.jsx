'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { isAddress, zeroAddress } from 'viem';
import { useAccount, useReadContracts } from 'wagmi';
import WalletGate from './WalletGate';
import TxButton from './TxButton';
import { shortAddress } from '../ConnectButton';
import {
  VAULT, MARKET, useVaultStats, usePositions, useChainTime,
  maturityOf, cohortStart, bnb, usd, day, month, timeLeft, parseAmount, sharesFor,
} from '../../lib/vaultHooks';
import { useMarketBook, useValues } from '../../lib/marketHooks';
import { PAYMENT_TOKENS, EMERGENCY, CHAIN_ID, MARKET_ADDRESS, shareId, cohortOf } from '../../lib/protocol';
import erc20Abi from '../../lib/abi/ERC20';

const COOLING_OFF = 7 * 24 * 3600;
const TABS = [
  ['offers', 'Offers'],
  ['buy', 'Make an offer'],
  ['mine', 'My trades'],
];
const token = (i) => PAYMENT_TOKENS[Number(i)];
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Market() {
  return (
    <>
      <header className="apphead">
        <p className="eyebrow">Market</p>
        <h1 className="h1-page">Emergency shares, person to person</h1>
        <p className="lead">
          Buyers escrow USDT or USDC in an offer. A holder who accepts gets a 7-day cooling-off to change their mind.
          After that, each side collects. Retirement shares can never be sold.
        </p>
      </header>
      <WalletGate>
        <Suspense fallback={null}>
          <Desk />
        </Suspense>
      </WalletGate>
    </>
  );
}

function Desk() {
  const params = useSearchParams();
  const [tab, setTab] = useState('offers');
  const { address } = useAccount();
  const { stats, refetch: refetchStats } = useVaultStats();
  const [now, refetchTime] = useChainTime();
  const { positions, refetch: refetchPositions } = usePositions(address, stats);
  const book = useMarketBook();
  const approval = useReadContracts({
    contracts: [{ ...VAULT, functionName: 'isApprovedForAll', args: [address, MARKET_ADDRESS] }],
    query: { enabled: Boolean(address) },
  });
  const approved = approval.data?.[0]?.result === true;

  const refresh = () => {
    refetchTime();
    refetchStats();
    refetchPositions();
    book.refetch();
    approval.refetch();
  };

  if (!stats || now == null) return <div className="panel app-empty"><p className="muted">Reading the market…</p></div>;
  const focus = params.get('cohort');

  return (
    <div className="appstack">
      <div className="toggle tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-pressed={tab === key} aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'offers' && (
        <Offers book={book} stats={stats} now={now} positions={positions} approved={approved} focus={focus} onDone={refresh} />
      )}
      {tab === 'buy' && <MakeOffer stats={stats} now={now} onDone={() => { refresh(); setTab('mine'); }} />}
      {tab === 'mine' && <MyTrades book={book} now={now} onDone={refresh} />}
    </div>
  );
}

// ------------------------------------------------------------------ open offers

function Offers({ book, stats, now, positions, approved, focus, onDone }) {
  const { address } = useAccount();
  const open = useMemo(
    () =>
      book.offers
        .filter((o) => o.remainingShares > 0n && Number(o.expiresAt) > now)
        .filter((o) => now + COOLING_OFF < maturityOf(stats, cohortOf(o.shareId)))
        .filter((o) => o.seller === zeroAddress || same(o.seller, address))
        .filter((o) => focus == null || cohortOf(o.shareId) === BigInt(focus))
        .reverse(),
    [book.offers, now, stats, address, focus]
  );
  const values = useValues(open.map((o) => o.remainingShares));

  if (book.isLoading) return <div className="panel app-empty"><p className="muted">Reading offers…</p></div>;
  if (open.length === 0) {
    return (
      <div className="panel app-empty">
        <h3>No open offers{focus != null ? ` for ${month(cohortStart(stats, focus))}` : ''}</h3>
        <p className="muted">When a buyer escrows money for emergency shares you hold, it appears here.</p>
      </div>
    );
  }

  return (
    <ul className="offers">
      {open.map((o, i) => (
        <Offer key={o.id} offer={o} value={values[i]} stats={stats} now={now} approved={approved}
          position={positions.find((p) => p.id === o.shareId)} onDone={onDone} />
      ))}
    </ul>
  );
}

function Offer({ offer, value, stats, now, position, approved, onDone }) {
  const { address } = useAccount();
  const t = token(offer.token);
  const cohort = cohortOf(offer.shareId);
  const [selling, setSelling] = useState(false);
  const [text, setText] = useState('');
  const perBnb = value ? (offer.remainingPayment * 10n ** 18n) / value : null;
  const mine = same(offer.buyer, address);

  // The most this holder can sell into this offer, valued in BNB.
  const cap = position && value != null ? (position.value < value ? position : { shares: offer.remainingShares, value }) : null;
  const wanted = text === '' ? cap?.value : parseAmount(text);
  const shares = cap ? sharesFor(wanted, cap) : 0n;
  const payment = shares === offer.remainingShares ? offer.remainingPayment : (offer.remainingPayment * shares) / offer.remainingShares;

  return (
    <li className="panel offer">
      <div className="offer-main">
        <div>
          <span className="k">{month(cohortStart(stats, cohort))} emergency shares</span>
          <span className="v tnum">{bnb(value)}</span>
          <span className="muted small">worth today · unlocks {day(maturityOf(stats, cohort))}</span>
        </div>
        <div>
          <span className="k">Buyer pays</span>
          <span className="v tnum">{usd(offer.remainingPayment, t.decimals, t.symbol)}</span>
          <span className="muted small">{perBnb ? `${usd(perBnb, 18, t.symbol)} per BNB of value` : ''}</span>
        </div>
        <div className="offer-meta muted small">
          <span>{offer.seller === zeroAddress ? 'Open to any holder' : 'Reserved for you'}</span>
          <span>Expires in {timeLeft(Number(offer.expiresAt), now)}</span>
          {mine && <span>Your offer</span>}
        </div>
      </div>
      {position && !mine && !selling && (
        <button type="button" className="btn sm" onClick={() => setSelling(true)}>Sell into this offer</button>
      )}
      {selling && (
        <div className="sellbox">
          <div className="field">
            <label htmlFor={`sell-${offer.id}`}>BNB of shares to sell (you hold {bnb(position.value)})</label>
            <div className="row">
              <input id={`sell-${offer.id}`} type="text" inputMode="decimal" placeholder={`Max (${bnb(cap?.value)})`}
                value={text} onChange={(e) => setText(e.target.value)} />
              <button type="button" className="btn ghost sm" onClick={() => setText('')}>Max</button>
            </div>
          </div>
          <p className="notice">
            You receive <b>{usd(payment, t.decimals, t.symbol)}</b> after a 7-day cooling-off. Until then your shares
            wait in the market and you can cancel. After it, the sale is final.
          </p>
          <div className="cta-row">
            {!approved ? (
              <TxButton key="approve" className="btn sm" label="1. Allow the market to move emergency shares"
                request={{ ...VAULT, functionName: 'setApprovalForAll', args: [MARKET_ADDRESS, true] }} onDone={onDone} />
            ) : (
              <TxButton key="accept" className="btn sm" label="Accept and start cooling-off" doneLabel="Accepted" disabled={!shares}
                request={{ ...MARKET, functionName: 'acceptOffer', args: [BigInt(offer.id), shares] }}
                onDone={() => { setSelling(false); onDone(); }} />
            )}
            <button type="button" className="btn ghost sm" onClick={() => setSelling(false)}>Close</button>
          </div>
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ make an offer

function MakeOffer({ stats, now, onDone }) {
  const { address } = useAccount();
  const cohorts = useMemo(() => {
    const list = [];
    for (let c = stats.currentCohort; c >= 0n; c--) {
      if (now + COOLING_OFF < maturityOf(stats, c)) list.push(c);
    }
    return list;
  }, [stats, now]);
  const [cohort, setCohort] = useState(cohorts[0] ?? 0n);
  const [bnbText, setBnbText] = useState('');
  const [payText, setPayText] = useState('');
  const [tokenIndex, setTokenIndex] = useState(0);
  const [days, setDays] = useState(7);
  const [sellerText, setSellerText] = useState('');

  const t = PAYMENT_TOKENS[tokenIndex];
  const id = shareId(cohort, EMERGENCY);
  const wantBnb = parseAmount(bnbText);
  const payment = parseAmount(payText, t.decimals);
  const seller = sellerText.trim() === '' ? zeroAddress : sellerText.trim();

  const reads = useReadContracts({
    contracts: [
      { ...VAULT, functionName: 'previewDeposit', args: [wantBnb ?? 0n] },
      { ...VAULT, functionName: 'totalSupply', args: [id] },
      { address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'balanceOf', args: [address] },
      { address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'allowance', args: [address, MARKET_ADDRESS] },
    ],
    query: { refetchInterval: 20_000 },
  });
  const [preview, supply, tokenBalance, allowance] = (reads.data || []).map((r) => (r?.status === 'success' ? r.result : null));
  const [supplyValue] = useValues(supply ? [supply] : []);
  const shares = wantBnb ? preview : null;

  let problem = '';
  if (cohorts.length === 0) problem = 'No month is open for trading yet.';
  else if (bnbText && wantBnb == null) problem = 'Enter a BNB amount like 0.5';
  else if (payText && payment == null) problem = `Enter a ${t.symbol} amount like 250`;
  else if (sellerText && !isAddress(seller)) problem = 'That seller address is not valid.';
  else if (payment != null && tokenBalance != null && payment > tokenBalance) problem = `You have ${usd(tokenBalance, t.decimals, t.symbol)}.`;

  const ready = wantBnb && shares && payment && !problem;
  const needsApproval = ready && (allowance ?? 0n) < payment;

  return (
    <div className="deposit-grid">
      <section className="panel">
        <div className="field">
          <label htmlFor="cohort">Month</label>
          <select id="cohort" value={String(cohort)} onChange={(e) => setCohort(BigInt(e.target.value))}>
            {cohorts.map((c) => (
              <option key={String(c)} value={String(c)}>
                {month(cohortStart(stats, c))} · unlocks {month(maturityOf(stats, c))}
              </option>
            ))}
          </select>
          <p className="hint">Emergency shares in this month: {bnb(supplyValue)}</p>
        </div>
        <div className="field">
          <label htmlFor="want">BNB of shares you want</label>
          <div className="row">
            <input id="want" type="text" inputMode="decimal" placeholder="1.0" value={bnbText} onChange={(e) => setBnbText(e.target.value)} />
            <span className="unit">BNB</span>
          </div>
          <p className="hint">Shares grow with staking rewards, so they will be worth more than this later.</p>
        </div>
        <div className="field">
          <label htmlFor="pay">You pay</label>
          <div className="row">
            <input id="pay" type="text" inputMode="decimal" placeholder="0.00" value={payText} onChange={(e) => setPayText(e.target.value)} />
            <div className="toggle">
              {PAYMENT_TOKENS.map((p) => (
                <button key={p.symbol} type="button" aria-pressed={tokenIndex === p.index} onClick={() => setTokenIndex(p.index)}>
                  {p.symbol}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">In your wallet: {usd(tokenBalance, t.decimals, t.symbol)}</p>
        </div>
        <div className="field">
          <label htmlFor="days">Offer open for <span className="rangeval">{days} days</span></label>
          <input id="days" type="range" min="1" max="30" value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="seller">Only this seller (optional)</label>
          <input id="seller" type="text" placeholder="0x… leave empty for anyone" value={sellerText}
            onChange={(e) => setSellerText(e.target.value)} autoComplete="off" spellCheck="false" />
        </div>
        {problem && <p className="formmsg err">{problem}</p>}
      </section>

      <section className="panel summary">
        <h2 className="h3">Your offer</h2>
        <dl className="kv">
          <div><dt>Buy</dt><dd className="tnum">{wantBnb ? bnb(wantBnb) : '—'} of {month(cohortStart(stats, cohort))} emergency shares</dd></div>
          <div><dt>Pay</dt><dd className="tnum">{payment ? usd(payment, t.decimals, t.symbol) : '—'}</dd></div>
          <div><dt>Unlocks</dt><dd>{day(maturityOf(stats, cohort))}, then you claim the BNB</dd></div>
          <div><dt>Seller</dt><dd>{seller === zeroAddress ? 'Any holder' : shortAddress(seller)}</dd></div>
        </dl>
        <p className="notice">
          Your {t.symbol} sits in the market contract until a holder accepts. Withdraw what is unspent any time. A seller
          can cancel within 7 days of accepting; you then get that payment back too.
        </p>
        {needsApproval ? (
          <TxButton key="approve" className="btn lg" label={`1. Allow the market to take ${usd(payment, t.decimals, t.symbol)}`}
            request={{ address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'approve', args: [MARKET_ADDRESS, payment] }}
            onDone={() => reads.refetch()} />
        ) : (
          <TxButton key="offer" className="btn lg" label="Escrow and publish offer" disabled={!ready}
            request={ready ? { ...MARKET, functionName: 'makeOffer', args: [id, shares, payment, tokenIndex, seller, BigInt(days * 86400)] } : null}
            onDone={onDone} />
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ my trades

function MyTrades({ book, now, onDone }) {
  const { address } = useAccount();
  const myOffers = book.offers.filter((o) => same(o.buyer, address) && o.remainingPayment + o.refundable > 0n).reverse();
  const bought = book.sales.filter((s) => same(s.offer?.buyer, address)).reverse();
  const sold = book.sales.filter((s) => same(s.seller, address)).reverse();
  const saleClaims = useReadContracts({
    contracts: bought.filter((s) => s.claimOpened).map((s) => ({ ...VAULT, functionName: 'getClaim', args: [s.claimId] })),
    query: { enabled: bought.some((s) => s.claimOpened) },
  });
  const claimOf = (s) => {
    const i = bought.filter((x) => x.claimOpened).indexOf(s);
    return saleClaims.data?.[i]?.status === 'success' ? saleClaims.data[i].result : null;
  };
  const values = useValues(sold.map((s) => s.shares));

  if (myOffers.length + bought.length + sold.length === 0) {
    return <div className="panel app-empty"><h3>No trades yet</h3><p className="muted">Offers you make and sales you accept show up here.</p></div>;
  }
  const refresh = () => { onDone(); saleClaims.refetch(); };

  return (
    <>
      {sold.length > 0 && (
        <section className="panel">
          <h2 className="h3">Shares you sold</h2>
          <ul className="trades">
            {sold.map((s, i) => {
              const t = token(s.offer.token);
              const ends = Number(s.acceptedAt) + COOLING_OFF;
              const cooling = now < ends;
              return (
                <li key={s.id} className="trade">
                  <span className="tnum">{bnb(values[i])} for <b>{usd(s.payment, t.decimals, t.symbol)}</b></span>
                  <span className="muted small">
                    {s.cancelled ? 'Cancelled, shares returned' : s.paymentCollected ? 'Paid' : cooling ? `Cooling-off ends in ${timeLeft(ends, now)}` : 'Payment ready'}
                  </span>
                  {!s.cancelled && cooling && (
                    <TxButton className="btn ghost sm" label="Cancel sale, get shares back" doneLabel="Cancelled"
                      request={{ ...MARKET, functionName: 'cancelSale', args: [BigInt(s.id)] }} onDone={refresh} />
                  )}
                  {!s.cancelled && !cooling && !s.paymentCollected && (
                    <TxButton className="btn sm" label={`Collect ${t.symbol}`} doneLabel="Collected"
                      request={{ ...MARKET, functionName: 'collectPayment', args: [BigInt(s.id), address] }} onDone={refresh} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {bought.length > 0 && (
        <section className="panel">
          <h2 className="h3">Shares you bought</h2>
          <ul className="trades">
            {bought.map((s) => {
              const t = token(s.offer.token);
              const ends = Number(s.acceptedAt) + COOLING_OFF;
              const cooling = now < ends;
              const claim = s.claimOpened ? claimOf(s) : null;
              return (
                <li key={s.id} className="trade">
                  <span className="tnum">Sale #{s.id} for <b>{usd(s.payment, t.decimals, t.symbol)}</b></span>
                  <span className="muted small">
                    {s.cancelled
                      ? 'Seller cancelled: withdraw the refund from your offer'
                      : s.claimOpened
                        ? claim?.withdrawn ? 'Matured and paid out in BNB' : `Matured: ${claim ? bnb(claim.amount) : 'BNB'} to withdraw`
                        : s.sharesCollected
                          ? 'Shares in your wallet'
                          : cooling ? `Seller can cancel for ${timeLeft(ends, now)}` : 'Shares ready'}
                  </span>
                  {!s.cancelled && !cooling && !s.sharesCollected && (
                    <TxButton className="btn sm" label="Collect shares" doneLabel="Collected"
                      request={{ ...MARKET, functionName: 'collectShares', args: [BigInt(s.id), address] }} onDone={refresh} />
                  )}
                  {s.claimOpened && claim && !claim.withdrawn && (
                    <TxButton className="btn sm" label="Withdraw BNB" doneLabel="Paid" disabled={now < Number(claim.readyAt)}
                      request={{ ...MARKET, functionName: 'withdrawSaleClaim', args: [BigInt(s.id), address] }} onDone={refresh} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {myOffers.length > 0 && (
        <section className="panel">
          <h2 className="h3">Your offers</h2>
          <ul className="trades">
            {myOffers.map((o) => {
              const t = token(o.token);
              const expired = now >= Number(o.expiresAt);
              return (
                <li key={o.id} className="trade">
                  <span className="tnum">Offer #{o.id}: <b>{usd(o.remainingPayment + o.refundable, t.decimals, t.symbol)}</b> unspent</span>
                  <span className="muted small">{expired || o.remainingShares === 0n ? 'Closed' : `Open for ${timeLeft(Number(o.expiresAt), now)}`}</span>
                  <TxButton className="btn ghost sm" label={`Withdraw ${t.symbol}`} doneLabel="Withdrawn"
                    request={{ ...MARKET, functionName: 'withdrawOffer', args: [BigInt(o.id), address] }} onDone={refresh} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
