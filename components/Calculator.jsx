'use client';

import { useState, useMemo } from 'react';
import { ASSETS, LOCK_YEARS, LOCK_MONTHS, PROTOCOL_FEE_PCT } from '../lib/config';
import ProjectionChart, { compactUsd } from './ProjectionChart';

const usd = (n) => (n >= 1_000_000 ? compactUsd(n) : `$${Math.round(n).toLocaleString('en-US')}`);

export default function Calculator() {
  const [assetKey, setAssetKey] = useState('bnb');
  const [monthly, setMonthly] = useState(1);
  const [price, setPrice] = useState(ASSETS.bnb.defaultPrice);
  const [growth, setGrowth] = useState(15);

  const asset = ASSETS[assetKey];

  function switchAsset(key) {
    setAssetKey(key);
    setPrice(ASSETS[key].defaultPrice);
  }

  const r = useMemo(() => {
    const m = Math.max(0, Number(monthly) || 0);
    const p = Math.max(0, Number(price) || 0);
    const g = Number(growth) / 100;

    // Staking yield the depositor keeps, after the protocol's share.
    const netApr = (asset.grossApr / 100) * (1 - PROTOCOL_FEE_PCT / 100);
    const yieldM = Math.pow(1 + netApr, 1 / 12);
    const priceM = Math.pow(1 + g, 1 / 12);

    // Every rung compounds for exactly the lock period before it matures.
    const tokensPerRung = m * Math.pow(yieldM, LOCK_MONTHS);

    // Month by month over two lock periods: a decade of deposits, then a
    // decade in which rung j matures in month j + LOCK_MONTHS.
    const span = LOCK_MONTHS * 2;
    const locked = new Array(span + 1).fill(0);
    const paid = new Array(span + 1).fill(0);
    let paidSoFar = 0;
    for (let t = 0; t <= span; t++) {
      const px = p * Math.pow(priceM, t);
      let tokens = 0;
      for (let j = 0; j < LOCK_MONTHS && j <= t; j++) {
        if (j + LOCK_MONTHS > t) tokens += m * Math.pow(yieldM, t - j);
        else if (j + LOCK_MONTHS === t) paidSoFar += tokensPerRung * px;
      }
      locked[t] = tokens * px;
      paid[t] = paidSoFar;
    }

    return {
      tokensIn: m * LOCK_MONTHS,
      costBasis: m * LOCK_MONTHS * p,
      tokensOut: tokensPerRung * LOCK_MONTHS,
      tokensPerRung,
      firstPayoutUsd: tokensPerRung * p * Math.pow(priceM, LOCK_MONTHS),
      lifetimeUsd: paid[span],
      locked,
      paid,
      netApr: netApr * 100,
    };
  }, [monthly, price, growth, asset]);

  return (
    <div className="calc">
      <div className="panel calc-inputs">
        <div className="field">
          <label htmlFor="asset-bnb">Asset</label>
          <div className="toggle">
            {Object.values(ASSETS).map((a) => (
              <button key={a.key} id={`asset-${a.key}`} type="button"
                aria-pressed={assetKey === a.key} onClick={() => switchAsset(a.key)}>
                {a.symbol}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="monthly">Deposited each month</label>
          <div className="row">
            <input id="monthly" type="number" min="0" step="0.1" value={monthly}
              onChange={(e) => setMonthly(e.target.value)} />
            <span className="unit">{asset.symbol}</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="price">{asset.symbol} price today</label>
          <div className="row">
            <span className="unit">USD</span>
            <input id="price" type="number" min="0" step="1" value={price}
              onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="growth">
            Assumed price growth
            <span className="rangeval">{growth}% / year</span>
          </label>
          <input id="growth" type="range" min="0" max="30" step="1" value={growth}
            onChange={(e) => setGrowth(e.target.value)} />
        </div>

        <p className="disclaim">
          A projection, not a promise. At 0% growth this returns less than you put in, and an asset
          that fails returns nothing. Staking is modelled at {asset.grossApr}% gross, leaving{' '}
          {r.netApr.toFixed(2)}% after the protocol&rsquo;s {PROTOCOL_FEE_PCT}% share. Deposits stop
          after {LOCK_YEARS} years in this model.
        </p>
      </div>

      <div className="results">
        <div className="headline">
          <span className="k">From year {LOCK_YEARS + 1}, every month</span>
          <span className="v">{usd(r.firstPayoutUsd)}</span>
          <span className="sub">
            {r.tokensPerRung.toFixed(3)} {asset.symbol} matures every month. Each rung is the deposit
            you made exactly {LOCK_YEARS} years earlier, plus its staking yield.
          </span>
        </div>

        <ProjectionChart locked={r.locked} paid={r.paid} lockYears={LOCK_YEARS} />

        <div className="tiles">
          <div className="tile">
            <span className="k">You contribute</span>
            <span className="v">{r.tokensIn.toFixed(0)} <small>{asset.symbol}</small></span>
          </div>
          <div className="tile">
            <span className="k">At today&rsquo;s price</span>
            <span className="v">{usd(r.costBasis)}</span>
          </div>
          <div className="tile">
            <span className="k">After staking</span>
            <span className="v">{r.tokensOut.toFixed(1)} <small>{asset.symbol}</small></span>
          </div>
          <div className="tile">
            <span className="k">Paid out by year 20</span>
            <span className="v">{usd(r.lifetimeUsd)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
