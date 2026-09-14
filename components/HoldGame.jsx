'use client';

import { useMemo, useState } from 'react';
import { aboutUsd, multiple, pctChange } from '../lib/format';
import { useWidth } from '../lib/useWidth';

const H = 300, PL = 56, PR = 20, PT = 18, PB = 30;

function Chart({ story, today, reached, soldAt, done, W }) {
  const pts = useMemo(() => {
    const s = story.series.map(([m, p]) => ({ m, v: p * story.coins }));
    s.push({ m: 'now', v: today * story.coins });
    return s;
  }, [story, today]);

  const lo = Math.log10(Math.min(...pts.map((p) => p.v)) * 0.7);
  const hi = Math.log10(Math.max(...pts.map((p) => p.v)) * 1.5);
  const x = (i) => PL + (i / (pts.length - 1)) * (W - PL - PR);
  const y = (v) => PT + (1 - (Math.log10(v) - lo) / (hi - lo)) * (H - PT - PB);
  const idx = (month) => Math.max(0, pts.findIndex((p) => p.m === month));

  // Reveal the line up to the moment being decided; after a sale, stop there.
  const shownMonth = soldAt != null ? story.moments[soldAt].month
    : reached < story.moments.length ? story.moments[reached].month : 'now';
  const cut = idx(shownMonth);
  const line = (from, to) => pts.slice(from, to + 1).map((p, k) => `${k ? 'L' : 'M'}${x(from + k).toFixed(1)},${y(p.v).toFixed(1)}`).join('');

  const ticks = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) ticks.push(Math.pow(10, e));
  const years = pts.map((p, i) => [p.m, i]).filter(([m]) => m.endsWith('-01') && Number(m.slice(0, 4)) % 2 === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" className="hold-chart"
      aria-label={`Value of ${story.coins} ${story.symbol} from ${story.entry.label} to today, on a logarithmic scale.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} className="c-grid" />
          <text x={PL - 8} y={y(t) + 3.5} textAnchor="end" className="c-label">{aboutUsd(t).replace(',000,000', 'M').replace(',000', 'k')}</text>
        </g>
      ))}
      {years.map(([m, i]) => (
        <text key={m} x={x(i)} y={H - 8} textAnchor="middle" className="c-label">{m.slice(0, 4)}</text>
      ))}
      {/* The future stays hidden until the choices are made, or it would give the answer away. */}
      {done && <path d={line(0, pts.length - 1)} className="hold-future" />}
      <path d={line(0, cut)} className="hold-past" />
      {story.moments.map((mo, i) => {
        const j = idx(mo.month);
        const state = soldAt === i ? 'sold' : i < reached || (soldAt == null && reached >= story.moments.length) ? 'held' : i === reached && soldAt == null ? 'now' : 'later';
        if (state === 'later' && !done) return null;
        return <circle key={mo.month} cx={x(j)} cy={y(pts[j].v)} r={state === 'now' || state === 'sold' ? 6 : 4} className={`hold-dot is-${state}`} />;
      })}
      {soldAt == null && reached >= story.moments.length && (
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].v)} r="6" className="hold-dot is-now" />
      )}
    </svg>
  );
}

export default function HoldGame({ stories, today }) {
  const [key, setKey] = useState('eth');
  const [reached, setReached] = useState(0);
  const [soldAt, setSoldAt] = useState(null);

  const story = stories[key];
  const nowPrice = today[key];
  const paid = story.entry.price * story.coins;
  const worthToday = nowPrice * story.coins;
  const done = soldAt != null || reached >= story.moments.length;

  const [box, measured] = useWidth(620);
  const chartW = Math.max(300, Math.min(measured, 760));

  function pick(k) { setKey(k); setReached(0); setSoldAt(null); }
  function restart() { setReached(0); setSoldAt(null); }

  const moment = story.moments[Math.min(reached, story.moments.length - 1)];
  const prev = reached === 0 ? { label: story.entry.label, price: story.entry.price } : story.moments[reached - 1];

  let result = null;
  if (soldAt != null) {
    const mo = story.moments[soldAt];
    const cash = mo.price * story.coins;
    const beat = cash > worthToday;
    const deepest = story.moments.slice(0, soldAt).reduce((worst, m, i, arr) => {
      const peak = Math.max(story.entry.price, ...arr.slice(0, i).map((a) => a.price));
      return Math.min(worst, pctChange(m.price, peak));
    }, 0);
    result = {
      title: `You sold in ${mo.label}, for about ${aboutUsd(cash)}.`,
      body: beat
        ? `That sale beat holding until today by about ${aboutUsd(cash - worthToday)}. To reach it you had to refuse ${soldAt} earlier chance${soldAt === 1 ? '' : 's'} to sell${deepest < 0 ? `, including a drop of ${Math.abs(deepest)}%` : ''}, and then sell at the right month.`
        : `Held, those ${story.coins} ${story.symbol} would be worth about ${aboutUsd(worthToday)} today. Selling cost you about ${aboutUsd(worthToday - cash)}.`,
    };
  } else if (done) {
    result = {
      title: `You held through all ${story.moments.length}.`,
      body: `${story.coins} ${story.symbol} bought for about ${aboutUsd(paid)} in ${story.entry.short} is worth about ${aboutUsd(worthToday)} today.`,
    };
  }

  return (
    <div className="hold">
      <div className="hold-top">
        <div className="toggle" role="group" aria-label="Choose a coin">
          <button type="button" aria-pressed={key === 'eth'} onClick={() => pick('eth')}>10 ETH &middot; 2016</button>
          <button type="button" aria-pressed={key === 'bnb'} onClick={() => pick('bnb')}>100 BNB &middot; 2017</button>
        </div>
        <p className="hold-start">
          You bought {story.coins} {story.symbol} in {story.entry.label} for about <b>{aboutUsd(paid)}</b>, and kept them in a wallet you could open any day.
        </p>
      </div>

      <div className="hold-grid">
        <div className="hold-chart-wrap" ref={box}>
          <Chart story={story} today={nowPrice} reached={reached} soldAt={soldAt} done={done} W={chartW} />
          <p className="hold-scale">Value of your {story.coins} {story.symbol}, month-end prices. Each gridline is ten times the one below.</p>
        </div>

        {!done ? (
          <div className="hold-card" aria-live="polite">
            <span className="hold-step">Moment {reached + 1} of {story.moments.length} &middot; {moment.label}</span>
            <span className="hold-value tnum">{aboutUsd(moment.price * story.coins)}</span>
            <span className={`hold-delta ${moment.price >= prev.price ? 'up' : 'down'}`}>
              {moment.price / prev.price >= 2
                ? `${multiple(moment.price, prev.price)}`
                : `${moment.price >= prev.price ? '+' : ''}${pctChange(moment.price, prev.price)}%`}{' '}
              since {prev.short || prev.label}
            </span>
            <p className="hold-say">{moment.say}</p>
            <p className="hold-ask">{moment.ask}</p>
            <div className="hold-actions">
              <button className="btn ghost" type="button" onClick={() => setSoldAt(reached)}>Sell everything</button>
              <button className="btn" type="button" onClick={() => setReached(reached + 1)}>Keep holding</button>
            </div>
          </div>
        ) : (
          <div className="hold-card is-result" aria-live="polite">
            <span className="hold-step">{soldAt != null ? 'You sold' : 'Today'}</span>
            <h3>{result.title}</h3>
            <p>{result.body}</p>
            <div className="hold-ladder">
              <b>In a ladder, you would never have faced these moments.</b> The 70% in your retirement
              bucket could not have been sold at any of them. {story.maturity}
            </div>
            <button className="btn ghost" type="button" onClick={restart}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
