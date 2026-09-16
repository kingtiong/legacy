// Telegram channel poster: publishes content/telegram-posts.json twice a day, at 09:00 and 20:00 Malaysia time
// (01:00 and 12:00 UTC), in English and Chinese. Only posts marked "approved": true are ever sent, in file order,
// cycling back to the start after the last one. Live numbers ({bnb_price}, {pool_bnb}, ...) are filled at posting time;
// if they cannot be read, that post is skipped for the next one.
//
// Credentials come from POSTER_ENV_FILE (default /etc/legacy-ladder/poster.env, root-only), never from the repository:
//   TELEGRAM_BOT_TOKEN=...
//   TELEGRAM_CHANNEL_EN=@your_english_channel
//   TELEGRAM_CHANNEL_ZH=@your_chinese_channel     (same as EN, or empty: one bilingual post instead)
//
// Flags: --preview [n]  print the next n posts with live numbers, send nothing
//        --post-now     send the next post immediately (for testing the channel)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, formatEther, http, parseAbi } from 'viem';
import { bsc } from 'viem/chains';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_FILE = process.env.POSTS_FILE || join(ROOT, 'content/telegram-posts.json');
const ENV_FILE = process.env.POSTER_ENV_FILE || '/etc/legacy-ladder/poster.env';
const STATE_FILE = process.env.POSTER_STATE_FILE || '/var/lib/legacy-ladder/poster-state.json';
const SITE = process.env.SITE_URL || 'https://decadium.club';
const RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed.bnbchain.org';
const SLOTS_UTC = (process.env.SLOTS_UTC || '01:00,12:00').split(',').map((s) => s.trim());
const VAULT = '0x0C09EC94aDb65314448562B028FC5AfDBa421742';
const GOVERNOR = '0xE398C073F29CcdaF5c03a0C19E3147c13B25991A';
const EPOCH = 2_629_746n;
const LOCK_EPOCHS = 120n;
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const log = (...a) => console.log(new Date().toISOString(), ...a);
const client = createPublicClient({ chain: bsc, transport: http(RPC_URL, { retryCount: 3, timeout: 20_000 }) });
const vaultAbi = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function stakedBnb() view returns (uint256)',
  'function GENESIS() view returns (uint256)',
  'function currentCohort() view returns (uint256)',
]);
const governorAbi = parseAbi(['function proposalCount() view returns (uint256)', 'function proposalDetailsAt(uint256) view returns (uint256, address[], uint256[], bytes[], bytes32)', 'function state(uint256) view returns (uint8)']);

function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8').split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
  );
}
const loadState = () => { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { next: 0, posted: {} }; } };
const saveState = (s) => { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); };
const approvedPosts = () => JSON.parse(readFileSync(POSTS_FILE, 'utf8')).posts.filter((p) => p.approved === true);

const num = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

/** Live values for placeholders. Anything unreadable is simply absent, and posts needing it are skipped. */
async function liveValues() {
  const v = { link: `${SITE}/app` };
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd', { signal: AbortSignal.timeout(10_000) });
    const price = (await res.json())?.binancecoin?.usd;
    if (price > 0) {
      v.bnb_price = num(price);
      v.bnb_100 = num(Math.round(price) * 100); // "about" figures are rounded
      v.bnb_12 = num(Math.round(price * 12 / 10) * 10);
      v.bnb_x100 = num(Math.round(price * 100 / 1000) * 1000);
      v.bnb_div10 = num(price / 10);
    }
  } catch (e) {
    log(`price unavailable: ${e.message}`);
  }
  try {
    const [assets, staked, genesis, cohort, count] = await Promise.all([
      client.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalAssets' }),
      client.readContract({ address: VAULT, abi: vaultAbi, functionName: 'stakedBnb' }),
      client.readContract({ address: VAULT, abi: vaultAbi, functionName: 'GENESIS' }),
      client.readContract({ address: VAULT, abi: vaultAbi, functionName: 'currentCohort' }),
      client.readContract({ address: GOVERNOR, abi: governorAbi, functionName: 'proposalCount' }),
    ]);
    // Pool figures only once there is something worth showing; posts that need them wait until then.
    if (assets >= 10n ** 18n) {
      v.pool_bnb = num(formatEther(assets), 2);
      v.staked_bnb = num(formatEther(staked), 2);
    }
    const unlock = new Date(Number(genesis + (cohort + 1n + LOCK_EPOCHS) * EPOCH) * 1000);
    v.unlock_month_en = `${EN_MONTHS[unlock.getUTCMonth()]} ${unlock.getUTCFullYear()}`;
    v.unlock_month_zh = `${unlock.getUTCFullYear()}年${unlock.getUTCMonth() + 1}月`;
    let open = 0;
    for (let i = 0n; i < count; i++) {
      const [id] = await client.readContract({ address: GOVERNOR, abi: governorAbi, functionName: 'proposalDetailsAt', args: [i] });
      if (Number(await client.readContract({ address: GOVERNOR, abi: governorAbi, functionName: 'state', args: [id] })) === 1) open++;
    }
    v.open_votes = String(open);
  } catch (e) {
    log(`chain data unavailable: ${(e.shortMessage || e.message).split('\n')[0]}`);
  }
  return v;
}

function fill(text, values) {
  const missing = [];
  const out = text.replace(/\{(\w+)\}/g, (_, k) => (values[k] != null ? values[k] : (missing.push(k), `{${k}}`)));
  return { text: out, missing };
}

/** The next approved post whose placeholders can all be filled, starting from the rotation pointer. */
function nextPost(state, values) {
  const posts = approvedPosts();
  if (posts.length === 0) return null;
  for (let tries = 0; tries < posts.length; tries++) {
    const index = (state.next + tries) % posts.length;
    const p = posts[index];
    const en = fill(p.en, values);
    const zh = fill(p.zh, values);
    if (en.missing.length || zh.missing.length) {
      log(`skipping ${p.id}: missing ${[...new Set([...en.missing, ...zh.missing])].join(', ')}`);
      continue;
    }
    return { post: p, index, en: en.text, zh: zh.text, count: posts.length };
  }
  return null;
}

async function telegram(token, chat, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function publish(state) {
  const env = readEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  const en = env.TELEGRAM_CHANNEL_EN;
  const zh = env.TELEGRAM_CHANNEL_ZH;
  if (!token || !en) {
    log(`not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_EN in ${ENV_FILE}`);
    return false;
  }
  const next = nextPost(state, await liveValues());
  if (!next) {
    log('nothing to post: no approved post could be filled');
    return false;
  }
  if (!zh || zh === en) {
    await telegram(token, en, `${next.en}\n\n— — —\n\n${next.zh}`);
  } else {
    await telegram(token, en, next.en);
    await telegram(token, zh, next.zh);
  }
  state.next = (next.index + 1) % next.count;
  log(`posted ${next.post.id} (${next.index + 1}/${next.count})`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const state = loadState();

  if (args[0] === '--preview') {
    const values = await liveValues();
    const n = Number(args[1] || 3);
    const posts = JSON.parse(readFileSync(POSTS_FILE, 'utf8')).posts;
    log(`${posts.filter((p) => p.approved).length}/${posts.length} posts approved; previewing all posts from the start`);
    for (const p of posts.slice(0, n)) {
      console.log(`\n===== ${p.id} [${p.style}] ${p.approved ? 'APPROVED' : 'not approved'}\n${fill(p.en, values).text}\n---\n${fill(p.zh, values).text}`);
    }
    return;
  }
  if (args[0] === '--post-now') {
    const ok = await publish(state);
    saveState(state);
    process.exit(ok ? 0 : 1);
  }

  log(`poster started: slots ${SLOTS_UTC.join(' and ')} UTC (09:00 and 20:00 Malaysia time by default), ${approvedPosts().length} approved posts`);
  for (;;) {
    const now = new Date();
    const hhmm = now.toISOString().slice(11, 16);
    const key = `${now.toISOString().slice(0, 10)} ${hhmm}`;
    // Post in the slot's minute, or catch up within 30 minutes if the process was restarting.
    for (const slot of SLOTS_UTC) {
      const [h, m] = slot.split(':').map(Number);
      const slotTime = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m);
      const slotKey = `${now.toISOString().slice(0, 10)} ${slot}`;
      if (now.getTime() >= slotTime && now.getTime() - slotTime < 30 * 60 * 1000 && !state.posted[slotKey]) {
        try {
          if (await publish(state)) {
            state.posted[slotKey] = true;
            // keep the record small
            for (const k of Object.keys(state.posted).sort().slice(0, -20)) delete state.posted[k];
          }
        } catch (e) {
          log(`post failed for ${slotKey}: ${e.message}`);
        }
        saveState(state);
      }
    }
    void key;
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

main().catch((e) => {
  log(`fatal: ${e.message}`);
  process.exit(1);
});
