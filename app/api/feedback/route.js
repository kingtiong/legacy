import { NextResponse } from 'next/server';
import { getPool } from '../../../lib/db';
import { createLimiter } from '../../../lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tester feedback from the ten-hour test edition (/test/feedback). Stored in test_feedback, shown on /admin.
const STEPS = new Set(['connect', 'deposit', 'ladder', 'claim', 'withdraw', 'other']);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TEN_MINUTES = 10 * 60 * 1000;
const perIp = createLimiter({ limit: 6, windowMs: TEN_MINUTES });
const overall = createLimiter({ limit: 400, windowMs: TEN_MINUTES, maxKeys: 1 });

function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim().slice(0, 45) || null;
}

export async function POST(request) {
  const ip = clientIp(request);
  const mine = perIp(ip || 'unknown');
  const all = mine.ok ? overall('all') : mine;
  if (!mine.ok || !all.ok) {
    return NextResponse.json({ error: 'Too many reports. Please try again in a few minutes.' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send valid JSON.' }, { status: 400 });
  }
  const step = String(body.step || '');
  const worked = body.worked === true;
  const message = String(body.message || '').trim().slice(0, 4000);
  const wallet = String(body.wallet || '').trim();
  const contact = String(body.contact || '').trim().slice(0, 190);
  const lang = body.lang === 'zh' ? 'zh' : 'en';
  const device = String(request.headers.get('user-agent') || '').slice(0, 200);

  if (!STEPS.has(step)) return NextResponse.json({ error: 'Choose a step.' }, { status: 400 });
  if (!worked && message.length < 3) {
    return NextResponse.json({ error: 'Please describe what went wrong.' }, { status: 400 });
  }
  if (wallet && !ADDRESS_RE.test(wallet)) {
    return NextResponse.json({ error: 'That wallet address is not valid.' }, { status: 400 });
  }

  try {
    await getPool().execute(
      `INSERT INTO test_feedback (step, worked, message, wallet, contact, lang, device, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [step, worked ? 1 : 0, message || null, wallet || null, contact || null, lang, device, ip]
    );
  } catch (err) {
    console.error('[feedback] insert failed:', err.message);
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
