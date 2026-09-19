import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getPool } from '../../lib/db';
import { isAdmin, loadSignups } from '../../lib/adminGuard';
import { NAME } from '../../lib/config';
import AdminTable from '../../components/AdminTable';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Waitlist admin',
  robots: { index: false, follow: false },
};

const DAY = 24 * 60 * 60 * 1000;

export default async function AdminPage() {
  if (!isAdmin(await headers())) notFound();

  const rows = await loadSignups(getPool());
  const [feedback] = await getPool().query(
    `SELECT id, created_at, step, worked, message, wallet, contact, lang, device
       FROM test_feedback ORDER BY created_at DESC, id DESC LIMIT 300`
  );
  const now = Date.now();
  const count = (fn) => rows.filter(fn).length;
  const sum = (chain) => rows.filter((r) => r.chain === chain).reduce((s, r) => s + r.monthly, 0);
  const fmt = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, ''));

  const stats = [
    ['Signups', rows.length, `${count((r) => now - Date.parse(r.createdAt) < 7 * DAY)} in the last 7 days`],
    ['BNB', count((r) => r.chain === 'bnb'), `${fmt(sum('bnb'))} BNB a month, combined`],
    ['ETH', count((r) => r.chain === 'eth'), `${fmt(sum('eth'))} ETH a month, combined`],
    ['Wallet connected', count((r) => r.wallet), rows.length ? `${Math.round((count((r) => r.wallet) / rows.length) * 100)}% of signups` : 'none yet'],
  ];

  return (
    <main className="admin">
      <div className="wrap">
        <div className="admin-head">
          <div>
            <p className="eyebrow">{NAME} &middot; admin</p>
            <h1>Waitlist signups</h1>
            <p>Newest first. Times are UTC. Monthly amounts are what people said they&rsquo;d contribute, not deposits.</p>
          </div>
          <a className="btn ghost" href="/admin/export" download>Download CSV</a>
        </div>

        <div className="admin-stats">
          {stats.map(([k, v, sub]) => (
            <div className="tile" key={k}>
              <span className="k">{k}</span>
              <span className="v">{v}</span>
              <span className="muted" style={{ fontSize: '.8rem' }}>{sub}</span>
            </div>
          ))}
        </div>

        <AdminTable rows={rows} />

        <div className="admin-head" style={{ marginTop: '3rem' }}>
          <div>
            <p className="eyebrow">Test edition</p>
            <h1>Tester reports</h1>
            <p>
              From decadium.club/test/guide. {feedback.length} shown, newest first:{' '}
              {feedback.filter((f) => f.worked).length} worked, {feedback.filter((f) => !f.worked).length} problems.
            </p>
          </div>
        </div>
        <div className="admin-scroll">
          <table className="admin admin-feedback">
            <thead>
              <tr><th>When (UTC)</th><th>Step</th><th>Result</th><th>What happened</th><th>Wallet</th><th>Contact</th><th>Device</th></tr>
            </thead>
            <tbody>
              {feedback.map((f) => (
                <tr key={f.id}>
                  <td>{new Date(f.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{f.step}</td>
                  <td>{f.worked ? 'Worked' : 'Problem'}</td>
                  <td style={{ whiteSpace: 'pre-wrap', maxWidth: '28rem' }}>{f.message}</td>
                  <td>{f.wallet ? `${f.wallet.slice(0, 6)}…${f.wallet.slice(-4)}` : ''}</td>
                  <td>{f.contact}</td>
                  <td style={{ maxWidth: '14rem' }}>{f.lang} · {f.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
