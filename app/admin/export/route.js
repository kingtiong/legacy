import { getPool } from '../../../lib/db';
import { isAdmin, loadSignups } from '../../../lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Quote every cell, and defuse anything a spreadsheet would run as a formula.
// The email pattern on the waitlist form accepts a leading "=", for one.
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request) {
  if (!isAdmin(request.headers)) return new Response('Not found', { status: 404 });

  const rows = await loadSignups(getPool());
  const head = ['joined_utc', 'email', 'chain', 'monthly', 'wallet', 'ip', 'updated_utc'];
  const lines = [head.join(',')].concat(
    rows.map((r) => [r.createdAt, r.email, r.chain, r.monthly, r.wallet, r.ip, r.updatedAt].map(cell).join(','))
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="legacy-ladder-waitlist-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
