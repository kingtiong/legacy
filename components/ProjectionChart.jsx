'use client';

import { useWidth } from '../lib/useWidth';

export function compactUsd(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

const H = 300, PL = 58, PR = 18, PT = 22, PB = 34;

export default function ProjectionChart({ locked, paid, lockYears }) {
  const [box, measured] = useWidth(660);
  const W = Math.max(300, Math.min(measured, 760));
  const n = locked.length - 1;
  const peak = Math.max(1, ...locked, ...paid);
  const step = niceStep(peak / 4);
  const top = Math.ceil(peak / step) * step;
  const x = (i) => PL + (i / n) * (W - PL - PR);
  const y = (v) => PT + (1 - v / top) * (H - PT - PB);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const yTicks = [];
  for (let v = 0; v <= top + step / 2; v += step) yTicks.push(v);
  // Five labels collide on a phone-width chart; keep the three that matter there.
  const years = (W < 520 ? [0, 10, 20] : [0, 5, 10, 15, 20]).filter((yr) => yr * 12 <= n);
  const mark = x(lockYears * 12);

  return (
    <div className="chart">
      <div className="chart-legend">
        <span><i className="sw sw-locked" />Locked in the ladder</span>
        <span><i className="sw sw-paid" />Paid out to you, cumulative</span>
      </div>
      <div className="chart-scroll" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Projected ladder value over ${n / 12} years. Locked value peaks at ${compactUsd(Math.max(...locked))}; total paid out reaches ${compactUsd(paid[n])}.`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="c-grid" />
              <text x={PL - 10} y={y(v) + 3.5} textAnchor="end" className="c-label">{compactUsd(v)}</text>
            </g>
          ))}
          {years.map((yr) => (
            <text key={yr} x={x(yr * 12)} y={H - 10} className="c-label"
              textAnchor={yr * 12 === n ? 'end' : yr === 0 ? 'start' : 'middle'}>Year {yr}</text>
          ))}
          <path d={`${path(locked)}L${x(n)},${y(0)}L${x(0)},${y(0)}Z`} className="c-area" />
          <path d={path(locked)} className="c-line-locked" />
          <path d={path(paid)} className="c-line-paid" />
          <line x1={mark} x2={mark} y1={PT - 6} y2={H - PB} className="c-mark" />
          <text x={mark + 6} y={PT + 4} className="c-mark-label">First rung matures</text>
          <circle cx={x(n)} cy={y(paid[n])} r="3.5" className="c-end" />
        </svg>
      </div>
    </div>
  );
}
