'use client';

import { useEffect, useRef } from 'react';

// One rung per monthly deposit: a decade of contributions fills the ladder,
// then each rung matures exactly ten years after it was deposited.
const RUNGS = 120;
const CYCLE_MS = 16000;
const TOP = 34;
const BOTTOM = 506;
const GAP = (BOTTOM - TOP) / (RUNGS - 1);
const RAIL_L = 104;
const RAIL_R = 256;
const CLS = ['rg0', 'rg1', 'rg2', 'rg3']; // pending, deposited, paid out, current

const rungY = (i) => BOTTOM - i * GAP;

function stateAt(p) {
  if (p < 0.42) { const f = p / 0.42; return { phase: 'in', dep: f * RUNGS, mat: 0, years: f * 10 }; }
  if (p < 0.52) return { phase: 'hold', dep: RUNGS, mat: 0, years: 10 };
  if (p < 0.94) { const f = (p - 0.52) / 0.42; return { phase: 'out', dep: RUNGS, mat: f * RUNGS, years: 10 + f * 10 }; }
  return { phase: 'out', dep: RUNGS, mat: RUNGS, years: 20 };
}

const LABEL = { in: 'Contributing monthly', hold: 'Locked — first rung matures', out: 'Receiving monthly' };

// What renders before JavaScript runs, and for anyone who prefers reduced
// motion: year fifteen, every rung deposited and half of them paid out.
const REST_PAID = 60;

export default function HeroLadder({ startYear }) {
  const rungs = useRef([]);
  const yearRef = useRef(null);
  const labelRef = useRef(null);
  const countRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const shown = new Array(RUNGS).fill(-1);
    const text = { year: '', label: '', count: '' };
    const t0 = performance.now();
    let raf;

    const set = (ref, key, value) => {
      if (text[key] !== value && ref.current) { text[key] = value; ref.current.textContent = value; }
    };

    const frame = (now) => {
      const s = stateAt(((now - t0) % CYCLE_MS) / CYCLE_MS);
      const cursor = s.phase === 'in' ? Math.floor(s.dep) : s.phase === 'out' && s.mat < RUNGS ? Math.floor(s.mat) : -1;
      for (let i = 0; i < RUNGS; i++) {
        const v = i === cursor ? 3 : i < s.mat ? 2 : i < s.dep ? 1 : 0;
        if (shown[i] !== v) { shown[i] = v; rungs.current[i]?.setAttribute('class', CLS[v]); }
      }
      set(yearRef, 'year', String(startYear + Math.min(20, Math.floor(s.years))));
      set(labelRef, 'label', LABEL[s.phase]);
      set(countRef, 'count', s.phase === 'out'
        ? `${Math.min(RUNGS, Math.floor(s.mat))} of ${RUNGS} rungs paid out`
        : `${Math.min(RUNGS, Math.floor(s.dep))} of ${RUNGS} rungs deposited`);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [startYear]);

  return (
    <figure className="hero-ladder">
      <svg viewBox="0 0 360 530" role="img" aria-label={`A ladder of ${RUNGS} monthly rungs. Each is deposited, locked for ten years, then paid out.`}>
        <text x={RAIL_L - 14} y="16" textAnchor="end" className="hl-head">DEPOSITED</text>
        <text x={RAIL_R + 14} y="16" className="hl-head">MATURES</text>
        <line x1={RAIL_L} y1={TOP - 12} x2={RAIL_L} y2={BOTTOM + 12} className="hl-rail" />
        <line x1={RAIL_R} y1={TOP - 12} x2={RAIL_R} y2={BOTTOM + 12} className="hl-rail" />
        {Array.from({ length: RUNGS }, (_, i) => (
          <line
            key={i}
            ref={(el) => { rungs.current[i] = el; }}
            x1={RAIL_L}
            x2={RAIL_R}
            y1={rungY(i)}
            y2={rungY(i)}
            className={i < REST_PAID ? 'rg2' : 'rg1'}
          />
        ))}
        {Array.from({ length: 10 }, (_, k) => (
          <g key={k}>
            <text x={RAIL_L - 14} y={rungY(k * 12) + 3} textAnchor="end" className="hl-year">{startYear + k}</text>
            <text x={RAIL_R + 14} y={rungY(k * 12) + 3} className="hl-year">{startYear + 10 + k}</text>
            <line x1={RAIL_L - 8} x2={RAIL_L} y1={rungY(k * 12)} y2={rungY(k * 12)} className="hl-tick" />
            <line x1={RAIL_R} x2={RAIL_R + 8} y1={rungY(k * 12)} y2={rungY(k * 12)} className="hl-tick" />
          </g>
        ))}
      </svg>
      <figcaption className="hl-readout">
        <span className="hl-yr tnum" ref={yearRef}>{startYear + 15}</span>
        <span className="hl-meta">
          <span ref={labelRef}>{LABEL.out}</span>
          <span className="hl-count" ref={countRef}>{REST_PAID} of {RUNGS} rungs paid out</span>
        </span>
      </figcaption>
    </figure>
  );
}
