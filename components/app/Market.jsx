'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { formatEther, isAddress, zeroAddress } from 'viem';
import { useAccount, useReadContracts } from 'wagmi';
import WalletGate from './WalletGate';
import TxButton from './TxButton';
import { shortAddress } from '../ConnectButton';
import {
  VAULT, MARKET, useVaultStats, usePositions, useChainTime,
  maturityOf, cohortStart, bnb, usd, day, month, timeLeft, parseAmount, sharesFor,
} from '../../lib/vaultHooks';
import { useMarketBook, useValues, span, feeOn } from '../../lib/marketHooks';
import { PAYMENT_TOKENS, EMERGENCY, CHAIN_ID, MARKET_ADDRESS, shareId, cohortOf } from '../../lib/protocol';
import erc20Abi from '../../lib/abi/ERC20';

const TABS = [
  ['sell', 'Sell my 30%'],
  ['buy', 'Buy'],
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
          The only early exit: sell your 30% emergency part to another person for USDT or USDC. List it at your own
          price, or accept a buyer’s offer. Every sale has a cooling-off during which the seller can still cancel.
          Retirement shares can never be sold.
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
  const [tab, setTab] = useState(params.get('tab') === 'buy' ? 'buy' : 'sell');
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
  const cool = book.coolingOff;

  return (
    <div className="appstack">
      <div className="toggle tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-pressed={tab === key} aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'sell' && (
        <>
          <Sell stats={stats} now={now} cool={cool} cancelFeeBps={book.cancelFeeBps} positions={positions} approved={approved} focus={focus}
            onDone={() => { refresh(); setTab('mine'); }} onApproved={refresh} />
          <h2 className="h3 market-sub">Or accept a buyer’s offer</h2>
          <Offers book={book} stats={stats} now={now} cool={cool} cancelFeeBps={book.cancelFeeBps} positions={positions} approved={approved} focus={focus}
            onlyMine onDone={refresh} />
        </>
      )}
      {tab === 'buy' && (
        <>
          <Listings book={book} stats={stats} now={now} cool={cool} tradeFeeBps={book.tradeFeeBps}
            onDone={() => { refresh(); setTab('mine'); }} />
          <details className="panel make-offer">
            <summary><b>Or make an offer at your own price</b></summary>
            <MakeOffer stats={stats} now={now} cool={cool} tradeFeeBps={book.tradeFeeBps}
              onDone={() => { refresh(); setTab('mine'); }} />
          </details>
        </>
      )}
      {tab === 'mine' && (
        <MyTrades book={book} now={now} cool={cool} cancelFeeBps={book.cancelFeeBps} onDone={refresh} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ open offers

function Offers({ book, stats, now, cool, cancelFeeBps, positions, approved, focus, onlyMine, onDone }) {
  const { address } = useAccount();
  const open = useMemo(
    () =>
      book.offers
        .filter((o) => o.remainingShares > 0n && Number(o.expiresAt) > now)
        .filter((o) => now + cool < maturityOf(stats, cohortOf(o.shareId)))
        .filter((o) => !onlyMine || positions.some((p) => p.id === o.shareId))
        .filter((o) => o.seller === zeroAddress || same(o.seller, address))
        .filter((o) => focus == null || cohortOf(o.shareId) === BigInt(focus))
        .reverse(),
    [book.offers, now, stats, address, focus, cool, onlyMine, positions]
  );
  const values = useValues(open.map((o) => o.remainingShares));

  if (book.isLoading) return <div className="panel app-empty"><p className="muted">Reading offers…</p></div>;
  if (open.length === 0) {
    return (
      <div className="panel app-empty">
        <p className="muted">No buyer offers for your shares right now. When a buyer escrows money for emergency shares you hold, it appears here.</p>
      </div>
    );
  }

  return (
    <ul className="offers">
      {open.map((o, i) => (
        <Offer key={o.id} offer={o} value={values[i]} stats={stats} now={now} cool={cool} cancelFeeBps={cancelFeeBps} approved={approved}
          position={positions.find((p) => p.id === o.shareId)} onDone={onDone} />
      ))}
    </ul>
  );
}

function Offer({ offer, value, stats, now, cool, cancelFeeBps, position, approved, onDone }) {
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
              <button type="button" className="btn ghost sm"
                onClick={() => setText(cap?.value != null ? formatEther(cap.value) : '')}>
                Max
              </button>
            </div>
          </div>
          <p className="notice">
            You receive <b>{usd(payment, t.decimals, t.symbol)}</b> in full after a {span(cool)} cooling-off — the
            buyer pays the market’s fee on top, not you. Until then your shares wait in the market and you may
            cancel, which costs you{' '}
            <b>{usd(feeOn(payment, cancelFeeBps), t.decimals, t.symbol)}</b>: half to the buyer for the wait, half to
            the DAO. After the cooling-off the sale is final.
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

// ------------------------------------------------------------------ sell my 30%: list at your own price

const SLICES = [5, 10, 20, 30];

function Sell({ stats, now, cool, cancelFeeBps, positions, approved, focus, onDone, onApproved }) {
  const { address } = useAccount();
  const sellable = positions.filter((p) => p.bucket === EMERGENCY && now + cool < maturityOf(stats, p.cohort));
  const [pick, setPick] = useState(null);
  const position = sellable.find((p) => String(p.cohort) === String(pick ?? focus)) ?? sellable[0];
  const [amountText, setAmountText] = useState('');
  const [priceText, setPriceText] = useState('');
  const [tokenIndex, setTokenIndex] = useState(0);
  const [days, setDays] = useState(7);

  if (sellable.length === 0) {
    return (
      <div className="panel app-empty">
        <h3>Nothing to sell yet</h3>
        <p className="muted">
          You can sell the emergency part (30%) of any deposit, until {span(cool)} before it unlocks. Make a deposit
          first, or check My trades for shares already listed.
        </p>
      </div>
    );
  }

  const t = PAYMENT_TOKENS[tokenIndex];
  const wanted = amountText === '' ? position.value : parseAmount(amountText);
  const shares = sharesFor(wanted, position);
  const price = parseAmount(priceText, t.decimals);
  const perBnb = price && wanted ? (price * 10n ** 18n) / wanted : null;

  let problem = '';
  if (amountText && wanted == null) problem = 'Enter a BNB amount like 0.002';
  else if (wanted != null && position.value != null && wanted > position.value) problem = `You hold ${bnb(position.value)} in this part.`;
  else if (priceText && price == null) problem = `Enter a ${t.symbol} amount like 5`;
  const ready = shares > 0n && price && !problem;

  return (
    <div className="deposit-grid">
      <section className="panel">
        <div className="field">
          <label htmlFor="sell-pos">Emergency part to sell</label>
          <select id="sell-pos" value={String(position.cohort)} onChange={(e) => { setPick(e.target.value); setAmountText(''); }}>
            {sellable.map((p) => (
              <option key={String(p.cohort)} value={String(p.cohort)}>
                {month(cohortStart(stats, p.cohort))} · {bnb(p.value)} · unlocks {day(maturityOf(stats, p.cohort))}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label id="sell-slice-label">How much of that month’s savings to sell</label>
          {/* The emergency bucket is the 30% of a deposit that may ever be sold, so a slice of the deposit is that
              same fraction of thirty. */}
          <div className="toggle slices" role="group" aria-labelledby="sell-slice-label">
            {SLICES.map((pct) => {
              const slice = position.value != null ? (position.value * BigInt(pct)) / 30n : null;
              const on = slice != null && wanted === slice;
              return (
                <button key={pct} type="button" aria-pressed={on}
                  onClick={() => setAmountText(slice != null ? formatEther(slice) : '')}>
                  {pct}%{pct === 30 ? ' (all)' : ''}
                </button>
              );
            })}
          </div>
          <label className="sr" htmlFor="sell-amount">Or an exact BNB value</label>
          <div className="row">
            <input id="sell-amount" type="text" inputMode="decimal" placeholder={`All (${bnb(position.value)})`}
              value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            <button type="button" className="btn ghost sm" onClick={() => setAmountText('')}>Reset</button>
          </div>
          <p className="hint">
            {wanted != null ? `${bnb(wanted)} of ${bnb(position.value)} — ` : ''}
            the retirement 70% of that month stays locked either way.
          </p>
        </div>
        <div className="field">
          <label htmlFor="sell-price">Your price</label>
          <div className="row">
            <input id="sell-price" type="text" inputMode="decimal" placeholder="0.00" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
            <div className="toggle">
              {PAYMENT_TOKENS.map((p) => (
                <button key={p.symbol} type="button" aria-pressed={tokenIndex === p.index} onClick={() => setTokenIndex(p.index)}>{p.symbol}</button>
              ))}
            </div>
          </div>
          <p className="hint">{perBnb ? `= ${usd(perBnb, 18, t.symbol)} per BNB of value. ` : ''}Buyers usually expect a discount for waiting until the unlock.</p>
        </div>
        <div className="field">
          <label htmlFor="sell-days">Listing open for <span className="rangeval">{days} day{days === 1 ? '' : 's'}</span></label>
          <input id="sell-days" type="range" min="1" max="30" value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
        {problem && <p className="formmsg err">{problem}</p>}
      </section>

      <section className="panel summary">
        <h2 className="h3">Your listing</h2>
        <dl className="kv">
          <div><dt>Selling</dt><dd className="tnum">{bnb(wanted)} of {month(cohortStart(stats, position.cohort))} emergency shares</dd></div>
          <div><dt>Price</dt><dd className="tnum">{price ? usd(price, t.decimals, t.symbol) : '—'}</dd></div>
          <div><dt>Paid to</dt><dd>{shortAddress(address)}</dd></div>
        </dl>
        <p className="notice">
          Your shares move into the market’s escrow. A buyer can buy all or part at your price, and pays the market’s
          fee on top, so you receive your full price. After a purchase you have <b>{span(cool)}</b> to cancel, which
          costs you <b>{price ? usd(feeOn(price, cancelFeeBps), t.decimals, t.symbol) : `${(cancelFeeBps / 100).toFixed(1)}%`}</b>{' '}
          — half to the buyer for the wait, half to the DAO — and nothing if you let it complete. Cancel the listing
          itself any time to take unsold shares back. Your retirement part (70%) can never be sold.
        </p>
        {!approved ? (
          <TxButton key="approve" className="btn lg" label="1. Allow the market to hold emergency shares"
            request={{ ...VAULT, functionName: 'setApprovalForAll', args: [MARKET_ADDRESS, true] }} onDone={onApproved} />
        ) : (
          <TxButton key="list" className="btn lg" label="List for sale" disabled={!ready}
            request={ready ? { ...MARKET, functionName: 'listShares', args: [position.id, shares, price, tokenIndex, BigInt(days * 86400)] } : null}
            onDone={onDone} />
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ buy: open listings

function Listings({ book, stats, now, cool, tradeFeeBps, onDone }) {
  const { address } = useAccount();
  const open = useMemo(
    () =>
      book.listings
        .filter((l) => l.remainingShares > 0n && Number(l.expiresAt) > now)
        .filter((l) => now + cool < maturityOf(stats, cohortOf(l.shareId)))
        .reverse(),
    [book.listings, now, stats, cool]
  );
  const values = useValues(open.map((l) => l.remainingShares));

  if (book.isLoading) return <div className="panel app-empty"><p className="muted">Reading listings…</p></div>;
  if (open.length === 0) {
    return (
      <div className="panel app-empty">
        <h3>No emergency shares for sale right now</h3>
        <p className="muted">When a holder lists shares, they appear here. You can also make an offer below.</p>
      </div>
    );
  }
  return (
    <ul className="offers">
      {open.map((l, i) => (
        <ListingCard key={l.id} listing={l} value={values[i]} stats={stats} now={now} cool={cool}
          tradeFeeBps={tradeFeeBps} mine={same(l.seller, address)} onDone={onDone} />
      ))}
    </ul>
  );
}

function ListingCard({ listing, value, stats, now, cool, tradeFeeBps, mine, onDone }) {
  const { address } = useAccount();
  const t = token(listing.token);
  const cohort = cohortOf(listing.shareId);
  const perBnb = value ? (listing.remainingPrice * 10n ** 18n) / value : null;
  const reads = useReadContracts({
    contracts: [
      { address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'allowance', args: [address, MARKET_ADDRESS] },
      { address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'balanceOf', args: [address] },
    ],
    query: { enabled: Boolean(address) && !mine, refetchInterval: 20_000 },
  });
  const [allowance, balance] = (reads.data || []).map((r) => (r?.status === 'success' ? r.result : null));
  const price = listing.remainingPrice;
  // The buyer pays the seller's price plus the market's fee; the seller receives the price untouched.
  const fee = feeOn(price, tradeFeeBps);
  const total = price + fee;
  const short = balance != null && balance < total;

  return (
    <li className="panel offer">
      <div className="offer-main">
        <div>
          <span className="k">{month(cohortStart(stats, cohort))} emergency shares</span>
          <span className="v tnum">{bnb(value)}</span>
          <span className="muted small">worth today · unlocks {day(maturityOf(stats, cohort))}</span>
        </div>
        <div>
          <span className="k">Price</span>
          <span className="v tnum">{usd(price, t.decimals, t.symbol)}</span>
          <span className="muted small">{perBnb ? `${usd(perBnb, 18, t.symbol)} per BNB of value` : ''}</span>
        </div>
        <div className="offer-meta muted small">
          <span>Seller {shortAddress(listing.seller)}</span>
          <span>Listed for {timeLeft(Number(listing.expiresAt), now)} more</span>
          {mine && <span>Your listing</span>}
        </div>
      </div>
      {!mine && (
        <>
          <p className="notice">
            You pay <b>{usd(total, t.decimals, t.symbol)}</b>: {usd(price, t.decimals, t.symbol)} to the seller and{' '}
            {usd(fee, t.decimals, t.symbol)} market fee to the DAO. The shares are yours after a <b>{span(cool)}</b>{' '}
            cooling-off, during which the seller may still cancel and refund you everything plus compensation.{' '}
            <b>Once they are yours you cannot sell them on</b> — the BNB inside can only be claimed when these shares
            unlock, on {day(maturityOf(stats, cohort))}.
          </p>
          {short && <p className="formmsg err">You have {usd(balance, t.decimals, t.symbol)}.</p>}
          <div className="cta-row">
            {(allowance ?? 0n) < total ? (
              <TxButton key="approve" className="btn sm" label={`1. Allow the market to take ${usd(total, t.decimals, t.symbol)}`} disabled={short}
                request={{ address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'approve', args: [MARKET_ADDRESS, total] }}
                onDone={() => reads.refetch()} />
            ) : (
              <TxButton key="buy" className="btn sm" label={`Buy for ${usd(price, t.decimals, t.symbol)}`} disabled={short}
                request={{ ...MARKET, functionName: 'buyListing', args: [BigInt(listing.id), listing.remainingShares] }}
                onDone={onDone} />
            )}
          </div>
        </>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ make an offer

function MakeOffer({ stats, now, cool, tradeFeeBps, onDone }) {
  const { address } = useAccount();
  const cohorts = useMemo(() => {
    const list = [];
    for (let c = stats.currentCohort; c >= 0n; c--) {
      if (now + cool < maturityOf(stats, c)) list.push(c);
    }
    return list;
  }, [stats, now, cool]);
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
  // The seller is offered `payment` and receives all of it; the market's fee is the buyer's to add.
  const fee = feeOn(payment, tradeFeeBps);
  const total = payment == null ? null : payment + fee;
  if (!problem && total != null && tokenBalance != null && total > tokenBalance) {
    problem = `You have ${usd(tokenBalance, t.decimals, t.symbol)}, and this offer costs ${usd(total, t.decimals, t.symbol)} with the fee.`;
  }

  const ready = wantBnb && shares && payment && !problem;
  const needsApproval = ready && (allowance ?? 0n) < total;

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
          <p className="hint">
            Goes to the seller in full. In your wallet: {usd(tokenBalance, t.decimals, t.symbol)}
          </p>
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
          <div><dt>To the seller</dt><dd className="tnum">{payment ? usd(payment, t.decimals, t.symbol) : '—'}</dd></div>
          <div><dt>Market fee</dt><dd className="tnum">{payment ? usd(fee, t.decimals, t.symbol) : '—'}</dd></div>
          <div><dt>You pay</dt><dd className="tnum">{total ? usd(total, t.decimals, t.symbol) : '—'}</dd></div>
          <div><dt>Unlocks</dt><dd>{day(maturityOf(stats, cohort))}, then you claim the BNB</dd></div>
          <div><dt>Seller</dt><dd>{seller === zeroAddress ? 'Any holder' : shortAddress(seller)}</dd></div>
        </dl>
        <p className="notice">
          Your {t.symbol} sits in the market contract until a holder accepts. Withdraw what is unspent any time. A
          seller can cancel within {span(cool)} of accepting; you then get everything back, fee included, plus
          compensation from them for the wait. <b>Shares you buy cannot be sold on</b>: you hold them until the month
          unlocks, then claim the BNB.
        </p>
        {needsApproval ? (
          <TxButton key="approve" className="btn lg" label={`1. Allow the market to take ${usd(total, t.decimals, t.symbol)}`}
            request={{ address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'approve', args: [MARKET_ADDRESS, total] }}
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

/** Cancelling is the seller's right, but not a free one: they pay for the days the buyer's money sat locked. */
function CancelSale({ sale, token: t, cancelFeeBps, onDone }) {
  const { address } = useAccount();
  const penalty = feeOn(sale.payment, cancelFeeBps);
  const reads = useReadContracts({
    contracts: [
      { address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'allowance', args: [address, MARKET_ADDRESS] },
      { address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'balanceOf', args: [address] },
    ],
    query: { enabled: Boolean(address) && penalty > 0n, refetchInterval: 20_000 },
  });
  const [allowance, balance] = (reads.data || []).map((r) => (r?.status === 'success' ? r.result : null));
  const short = penalty > 0n && balance != null && balance < penalty;

  return (
    <span className="cancelbox">
      {penalty > 0n && (
        <span className="muted small">
          Cancelling costs {usd(penalty, t.decimals, t.symbol)}: half to the buyer for the wait, half to the DAO.
          {short ? ` You hold ${usd(balance, t.decimals, t.symbol)}.` : ''}
        </span>
      )}
      {penalty > 0n && (allowance ?? 0n) < penalty ? (
        <TxButton key="approve" className="btn ghost sm" disabled={short}
          label={`1. Allow the ${usd(penalty, t.decimals, t.symbol)} fee`}
          request={{ address: t.address, abi: erc20Abi, chainId: CHAIN_ID, functionName: 'approve', args: [MARKET_ADDRESS, penalty] }}
          onDone={() => reads.refetch()} />
      ) : (
        <TxButton key="cancel" className="btn ghost sm" label="Cancel sale, get shares back" doneLabel="Cancelled"
          disabled={short}
          request={{ ...MARKET, functionName: 'cancelSale', args: [BigInt(sale.id)] }} onDone={onDone} />
      )}
    </span>
  );
}

function MyTrades({ book, now, cool, cancelFeeBps, onDone }) {
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
  const myListings = book.listings.filter((l) => same(l.seller, address) && (l.remainingShares > 0n || l.claimOpened)).reverse();
  const listingValues = useValues(myListings.map((l) => l.remainingShares));

  if (myOffers.length + bought.length + sold.length + myListings.length === 0) {
    return <div className="panel app-empty"><h3>No trades yet</h3><p className="muted">Your listings, offers, sales and purchases show up here.</p></div>;
  }
  const refresh = () => { onDone(); saleClaims.refetch(); };

  return (
    <>
      {myListings.length > 0 && (
        <section className="panel">
          <h2 className="h3">Your listings</h2>
          <ul className="trades">
            {myListings.map((l, i) => {
              const t = token(l.token);
              const open = l.remainingShares > 0n && now < Number(l.expiresAt);
              return (
                <li key={l.id} className="trade">
                  <span className="tnum">{bnb(listingValues[i])} for <b>{usd(l.remainingPrice, t.decimals, t.symbol)}</b></span>
                  <span className="muted small">
                    {l.claimOpened ? 'Unlocked before selling: BNB to withdraw' : open ? `Listed for ${timeLeft(Number(l.expiresAt), now)} more` : 'Listing ended: take your shares back'}
                  </span>
                  {l.remainingShares > 0n && (
                    <TxButton className="btn ghost sm" label="Cancel listing, take shares back" doneLabel="Returned"
                      request={{ ...MARKET, functionName: 'cancelListing', args: [BigInt(l.id), address] }} onDone={refresh} />
                  )}
                  {l.claimOpened && (
                    <TxButton className="btn sm" label="Withdraw BNB" doneLabel="Paid"
                      request={{ ...MARKET, functionName: 'withdrawListingClaim', args: [BigInt(l.id), address] }} onDone={refresh} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {sold.length > 0 && (
        <section className="panel">
          <h2 className="h3">Shares you sold</h2>
          <ul className="trades">
            {sold.map((s, i) => {
              const t = token(s.offer.token);
              const ends = Number(s.acceptedAt) + cool;
              const cooling = now < ends;
              return (
                <li key={s.id} className="trade">
                  <span className="tnum">{bnb(values[i])} for <b>{usd(s.payment, t.decimals, t.symbol)}</b></span>
                  <span className="muted small">
                    {s.cancelled ? 'Cancelled, shares returned' : s.paymentCollected ? 'Paid' : cooling ? `Cooling-off ends in ${timeLeft(ends, now)}` : 'Payment ready'}
                  </span>
                  {!s.cancelled && cooling && (
                    <CancelSale sale={s} token={t} cancelFeeBps={cancelFeeBps} onDone={refresh} />
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
              const ends = Number(s.acceptedAt) + cool;
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
