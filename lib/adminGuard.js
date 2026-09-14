import { timingSafeEqual } from 'node:crypto';

// Caddy asks for the admin password, then adds this key to the proxied request.
// Checking it here too means the admin area stays shut even if that Caddy route
// is removed or a crafted path slips past its matcher.
export function isAdmin(headers) {
  const expected = process.env.ADMIN_PROXY_KEY;
  const given = headers.get('x-ladder-admin-key');
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function loadSignups(pool) {
  const [rows] = await pool.query(
    `SELECT id, email, chain, wallet, monthly, ip, created_at, updated_at
       FROM waitlist ORDER BY created_at DESC, id DESC LIMIT 10000`
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    chain: r.chain,
    wallet: r.wallet,
    monthly: Number(r.monthly),
    ip: r.ip,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
