import { NextResponse } from 'next/server';
import { getPool } from '../../../lib/db';
import { createLimiter } from '../../../lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const CHAINS = new Set(['bnb', 'eth']);

const TEN_MINUTES = 10 * 60 * 1000;
// Per connection: generous for someone fixing a typo, useless to a script.
const perIp = createLimiter({ limit: 10, windowMs: TEN_MINUTES });
// Across everyone: caps how much a botnet rotating addresses can write.
const overall = createLimiter({ limit: 300, windowMs: TEN_MINUTES, maxKeys: 1 });

function tooMany(retryAfter) {
  const minutes = Math.ceil(retryAfter / 60);
  return NextResponse.json(
    { error: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

// Caddy overwrites X-Forwarded-For with the real client address (it trusts no
// upstream proxies), and the app only listens on 127.0.0.1, so this can't be spoofed.
function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim().slice(0, 45) || null;
}

export async function POST(request) {
  const ip = clientIp(request);

  // Per-IP first, so one noisy client can't use up everyone's shared allowance.
  const mine = perIp(ip || 'unknown');
  if (!mine.ok) return tooMany(mine.retryAfter);
  const all = overall('all');
  if (!all.ok) return tooMany(all.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send valid JSON.' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const chain = String(body.chain || '').trim().toLowerCase();
  const wallet = String(body.wallet || '').trim();
  const monthly = Number(body.monthly);

  if (!EMAIL_RE.test(email) || email.length > 190) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
  }
  if (!CHAINS.has(chain)) {
    return NextResponse.json({ error: 'Choose BNB or ETH.' }, { status: 400 });
  }
  if (wallet && !ADDRESS_RE.test(wallet)) {
    return NextResponse.json({ error: 'That wallet address is not valid.' }, { status: 400 });
  }
  if (!Number.isFinite(monthly) || monthly < 0 || monthly > 1e6) {
    return NextResponse.json({ error: 'Enter a monthly amount.' }, { status: 400 });
  }

  try {
    await getPool().execute(
      `INSERT INTO waitlist (email, chain, wallet, monthly, ip)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         chain = VALUES(chain),
         wallet = COALESCE(VALUES(wallet), wallet),
         monthly = VALUES(monthly),
         updated_at = CURRENT_TIMESTAMP`,
      [email, chain, wallet || null, monthly, ip]
    );
  } catch (err) {
    console.error('[waitlist] insert failed:', err.message);
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
