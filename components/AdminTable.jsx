'use client';

import { useMemo, useState } from 'react';

const EXPLORER = { bnb: 'https://bscscan.com/address/', eth: 'https://etherscan.io/address/' };
const utc = (iso) => iso.slice(0, 16).replace('T', ' ');
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function AdminTable({ rows }) {
  const [q, setQ] = useState('');
  const [chain, setChain] = useState('all');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (chain === 'all' || r.chain === chain) &&
      (!needle || [r.email, r.wallet, r.ip].some((v) => v && v.toLowerCase().includes(needle)))
    );
  }, [rows, q, chain]);

  if (rows.length === 0) {
    return (
      <div className="table-scroll admin-empty">
        <p>No signups yet. They&rsquo;ll appear here as soon as someone joins from the waitlist form.</p>
      </div>
    );
  }

  return (
    <>
      <div className="admin-tools">
        <input type="search" placeholder="Search email, wallet or IP" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Search signups" />
        <div className="toggle" role="group" aria-label="Filter by asset">
          {['all', 'bnb', 'eth'].map((c) => (
            <button key={c} type="button" aria-pressed={chain === c} onClick={() => setChain(c)}>
              {c === 'all' ? 'All' : c.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="admin-count">Showing {shown.length} of {rows.length}</span>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Joined (UTC)</th>
              <th>Email</th>
              <th>Asset</th>
              <th style={{ textAlign: 'right' }}>Monthly</th>
              <th>Wallet</th>
              <th>IP</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="mono">{utc(r.createdAt)}</td>
                <td><a href={`mailto:${r.email}`}>{r.email}</a></td>
                <td><span className={`chain-tag chain-${r.chain}`}>{r.chain.toUpperCase()}</span></td>
                <td className="mono num">{r.monthly}</td>
                <td className="mono">
                  {r.wallet
                    ? <a href={EXPLORER[r.chain] + r.wallet} target="_blank" rel="noreferrer" title={r.wallet}>{short(r.wallet)}</a>
                    : <span className="muted">—</span>}
                </td>
                <td className="mono">{r.ip || '—'}</td>
                <td className="mono muted">{r.updatedAt === r.createdAt ? '—' : utc(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="admin-empty"><p>No signups match that search.</p></div>}
      </div>
    </>
  );
}
