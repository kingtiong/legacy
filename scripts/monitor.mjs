// Legacy Ladder monitor: watches the live contracts, the keeper and the website, and sends alerts to Telegram.
//
// Every INTERVAL_SECONDS (300) it checks, and alerts once when something goes wrong (repeating at most every 6 hours,
// with a "resolved" message when it clears):
//   - website down
//   - vault accounting broken (claims not covered, reserved BNB missing)            [critical]
//   - fee recipient or curator changed, or a handover started                        [critical]
//   - DAO settings changed (quorum, voting period, threshold, timelock delay)
//   - a new DAO proposal, and a proposal that passed or was queued (depositors should look before it executes)
//   - a listed validator jailed, or the validator list changed
//   - 1 BNB or more idle for over an hour (the keeper is not staking)
//   - keeper stopped, low on gas, or spending more than staking costs                [possible key compromise]
//   - the retired deploy wallet sending anything                                     [possible key compromise]
//   - the pool nearly at its deposit cap
// Once a day (DAILY_SUMMARY_UTC_HOUR, default 1 = 09:00 in Malaysia) it sends a summary.
//
// Telegram credentials are read from MONITOR_ENV_FILE (default /etc/legacy-ladder/monitor.env, root-only), never
// from the repository:  TELEGRAM_BOT_TOKEN=...  TELEGRAM_CHAT_ID=...
// Without them, alerts are only logged.
//
// Flags: --once (one pass, then exit), --test-alert (send a test message and exit), --summary (send the summary now),
//        --find-chat (after messaging the bot, print the chat ids it has seen, for TELEGRAM_CHAT_ID).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPublicClient, decodeFunctionData, formatEther, http, parseAbi } from 'viem';
import { bsc } from 'viem/chains';

// Mainnet addresses (deployments/bsc-mainnet.md). MONITOR_ADDRESSES (JSON) overrides them for local fork testing.
const ADDR = {
  vault: '0x0C09EC94aDb65314448562B028FC5AfDBa421742',
  market: '0xCb4f25dD8E185e7B698a0DD48fE2b15861fAC8F1',
  governor: '0xE398C073F29CcdaF5c03a0C19E3147c13B25991A',
  treasury: '0x81D43e758CC917802DeFeA3A290D138302B8b8A2',
  stakeHub: '0x0000000000000000000000000000000000002002',
  keeper: '0xB888df3068230B1dEaCd56F5D259D6BD0661B7E5',
  deployer: '0x50EC98729acC0a72fdfb538E6ce6595131bACdeb',
  ...JSON.parse(process.env.MONITOR_ADDRESSES || '{}'),
};
const ZERO = '0x0000000000000000000000000000000000000000';
const SITE = process.env.SITE_URL || 'https://coreos.live/project21';
const RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed.bnbchain.org';
const INTERVAL = Number(process.env.INTERVAL_SECONDS || 300) * 1000;
const STATE_FILE = process.env.MONITOR_STATE_FILE || '/var/lib/legacy-ladder/monitor-state.json';
const ENV_FILE = process.env.MONITOR_ENV_FILE || '/etc/legacy-ladder/monitor.env';
const KEEPER_LOG = process.env.KEEPER_LOG || '/root/.pm2/logs/ladder-keeper-out.log';
const SUMMARY_HOUR = Number(process.env.DAILY_SUMMARY_UTC_HOUR ?? 1);
const REPEAT_MS = 6 * 3600 * 1000;
const BNB = 10n ** 18n;
const KEEPER_LOW = 2n * 10n ** 15n; // 0.002 BNB
const KEEPER_MAX_SPEND_PER_CHECK = 5n * 10n ** 14n; // 0.0005 BNB, ~15 staking runs
const EXPLORER = 'https://bscscan.com';

const vaultAbi = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function stakedBnb() view returns (uint256)',
  'function delegatableBnb() view returns (uint256)',
  'function depositCap() view returns (uint256)',
  'function reservedLiquidity() view returns (uint256)',
  'function unbonding() view returns (uint256)',
  'function outstandingClaims() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function pendingFeeRecipient() view returns (address)',
  'function curator() view returns (address)',
  'function pendingCurator() view returns (address)',
  'function validators() view returns (address[])',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address, uint256) view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  'function claimCount() view returns (uint256)',
  // decoded in proposal actions
  'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
  'function requestClaim(uint256 id, uint256 shares)',
  'function addValidator(address operator)',
  'function removeValidator(address operator)',
  'function redelegate(address from, address to, uint256 shares)',
  'function transferFeeRecipient(address next)',
  'function transferCurator(address next)',
]);
const governorAbi = parseAbi([
  'function proposalCount() view returns (uint256)',
  'function proposalDetailsAt(uint256) view returns (uint256, address[], uint256[], bytes[], bytes32)',
  'function proposalDescription(uint256) view returns (string)',
  'function state(uint256) view returns (uint8)',
  'function proposalDeadline(uint256) view returns (uint256)',
  'function proposalEta(uint256) view returns (uint256)',
  'function proposalVotes(uint256) view returns (uint256 against, uint256 forVotes, uint256 abstain)',
  'function quorumNumerator() view returns (uint256)',
  'function votingPeriod() view returns (uint256)',
  'function votingDelay() view returns (uint256)',
  'function proposalThreshold() view returns (uint256)',
]);
const timelockAbi = parseAbi(['function getMinDelay() view returns (uint256)']);
const hubAbi = parseAbi(['function getValidatorBasicInfo(address) view returns (uint256, bool, uint256)']);
const STATES = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];

const client = createPublicClient({ chain: bsc, transport: http(RPC_URL, { retryCount: 3, timeout: 20_000 }) });
const log = (...a) => console.log(new Date().toISOString(), ...a);
const bnb = (wei, d = 4) => `${Number(formatEther(wei)).toLocaleString('en-US', { maximumFractionDigits: d })} BNB`;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const when = (ts) => new Date(Number(ts) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// ---------------------------------------------------------------- config, state, delivery

function readEnvFile() {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
  );
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { alerts: {}, proposals: {}, baseline: null };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

async function send(text) {
  const env = readEnvFile();
  const token = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chat = env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  log(`SEND ${text.replace(/\n/g, ' | ')}`);
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `Legacy Ladder\n${text}`, disable_web_page_preview: true }),
    });
    if (!res.ok) log(`telegram error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (e) {
    log(`telegram unreachable: ${e.message}`);
    return false;
  }
}

/** Raise or clear an alert. Sends on first occurrence, repeats at most every 6 hours, and says when it clears. */
async function alert(state, key, active, text, level = 'WARNING') {
  const a = state.alerts[key];
  const now = Date.now();
  if (active) {
    if (!a || now - a.lastSent > REPEAT_MS) {
      await send(`${level === 'CRITICAL' ? '🚨 CRITICAL' : '⚠️ ' + level}: ${text}`);
      state.alerts[key] = { since: a?.since ?? now, lastSent: now, text };
    }
  } else if (a) {
    await send(`✅ Resolved: ${a.text}`);
    delete state.alerts[key];
  }
}

// ---------------------------------------------------------------- checks

async function checkSite(state) {
  let ok = true;
  let detail = '';
  for (const path of ['', '/app']) {
    try {
      const res = await fetch(SITE + path, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (res.status !== 200) {
        ok = false;
        detail = `${SITE}${path} returned ${res.status}`;
      }
    } catch (e) {
      ok = false;
      detail = `${SITE}${path} unreachable (${e.message})`;
    }
  }
  state.siteFails = ok ? 0 : (state.siteFails || 0) + 1;
  await alert(state, 'site', state.siteFails >= 2, `Website down: ${detail}`);
}

function describeAction(target, value, data) {
  if ((!data || data === '0x') && value > 0n) return `send ${bnb(value)} to ${target}`;
  if (same(target, ADDR.vault)) {
    try {
      const c = decodeFunctionData({ abi: vaultAbi, data });
      switch (c.functionName) {
        case 'safeTransferFrom':
          return `transfer ${c.args[3]} shares (id ${c.args[2]}) to ${c.args[1]}`;
        case 'requestClaim':
          return `redeem ${c.args[1]} fee shares into BNB`;
        case 'addValidator':
          return `list validator ${c.args[0]}`;
        case 'removeValidator':
          return `remove validator ${c.args[0]}`;
        case 'redelegate':
          return `move ${c.args[2]} stake credits from ${c.args[0]} to ${c.args[1]}`;
        case 'transferFeeRecipient':
          return `HAND THE FEE RECIPIENT ROLE to ${c.args[0]}`;
        case 'transferCurator':
          return `HAND THE CURATOR ROLE to ${c.args[0]}`;
        default:
          return `vault.${c.functionName}(…)`;
      }
    } catch {
      // raw call below
    }
  }
  if (same(target, ADDR.governor)) return 'change DAO voting settings';
  if (same(target, ADDR.treasury)) return 'change the timelock (delay or roles)';
  return `call ${target} with ${data.slice(0, 10)}…${value > 0n ? ` and ${bnb(value)}` : ''}`;
}

async function checkChain(state, snapshot) {
  const read = (address, abi, functionName, args) => client.readContract({ address, abi, functionName, args });
  const v = (fn, args) => read(ADDR.vault, vaultAbi, fn, args);
  const [
    totalAssets, staked, idle, cap, reserved, unbonding, outstanding,
    feeRecipient, pendingFee, curator, pendingCurator, validators, balance,
    quorum, period, delay, threshold, minDelay, proposalCount,
    keeperBal, deployerNonce, deployerBal, feeShares, supply, claimCount,
  ] = await Promise.all([
    v('totalAssets'), v('stakedBnb'), v('delegatableBnb'), v('depositCap'), v('reservedLiquidity'), v('unbonding'),
    v('outstandingClaims'), v('feeRecipient'), v('pendingFeeRecipient'), v('curator'), v('pendingCurator'),
    v('validators'), client.getBalance({ address: ADDR.vault }),
    read(ADDR.governor, governorAbi, 'quorumNumerator'), read(ADDR.governor, governorAbi, 'votingPeriod'),
    read(ADDR.governor, governorAbi, 'votingDelay'), read(ADDR.governor, governorAbi, 'proposalThreshold'),
    read(ADDR.treasury, timelockAbi, 'getMinDelay'), read(ADDR.governor, governorAbi, 'proposalCount'),
    client.getBalance({ address: ADDR.keeper }), client.getTransactionCount({ address: ADDR.deployer }),
    client.getBalance({ address: ADDR.deployer }), v('balanceOf', [ADDR.treasury, 2n]), v('totalSupply'),
    v('claimCount'),
  ]);
  Object.assign(snapshot, { totalAssets, staked, idle, cap, keeperBal, feeShares, supply, proposalCount, claimCount });
  snapshot.feeValue = feeShares > 0n ? await v('previewRedeem', [feeShares]) : 0n;

  // Accounting: the promises the vault's invariant tests enforce.
  await alert(state, 'claims-covered', reserved + unbonding < outstanding,
    `Vault claims not covered: reserved ${bnb(reserved)} + unbonding ${bnb(unbonding)} < owed ${bnb(outstanding)}. ${EXPLORER}/address/${ADDR.vault}`,
    'CRITICAL');
  await alert(state, 'reserve-held', balance < reserved,
    `Vault holds ${bnb(balance)} but must hold ${bnb(reserved)} reserved for claims. ${EXPLORER}/address/${ADDR.vault}`,
    'CRITICAL');

  // Roles: both must stay with the DAO treasury unless the DAO itself hands them over.
  await alert(state, 'fee-recipient', !same(feeRecipient, ADDR.treasury),
    `Fee recipient is now ${feeRecipient}, not the DAO treasury.`, 'CRITICAL');
  await alert(state, 'curator', !same(curator, ADDR.treasury), `Curator is now ${curator}, not the DAO treasury.`, 'CRITICAL');
  await alert(state, 'pending-fee', !same(pendingFee, ZERO),
    `A fee-recipient handover to ${pendingFee} has started (a passed DAO vote).`, 'CRITICAL');
  await alert(state, 'pending-curator', !same(pendingCurator, ZERO),
    `A curator handover to ${pendingCurator} has started (a passed DAO vote).`, 'CRITICAL');

  // Settings: compared with what they were when monitoring began.
  const settings = { quorum: String(quorum), period: String(period), delay: String(delay), threshold: String(threshold), minDelay: String(minDelay) };
  if (!state.baseline) state.baseline = settings;
  const changed = Object.keys(settings).filter((k) => settings[k] !== state.baseline[k]);
  if (changed.length > 0) {
    // Only a passed vote can change these: report once, then treat the new values as normal.
    await send(`⚠️ DAO settings changed: ${changed.map((k) => `${k} ${state.baseline[k]} → ${settings[k]}`).join(', ')}.`);
    state.baseline = settings;
  }

  // Validators: list changes and jailing.
  const list = validators.map((x) => x.toLowerCase()).sort().join(',');
  if (!state.validators) state.validators = list;
  if (list !== state.validators) {
    await send(`⚠️ Validator list changed (by DAO vote): now ${validators.map(short).join(', ')}.`);
    state.validators = list;
  }
  for (const op of validators) {
    const [, jailed] = await read(ADDR.stakeHub, hubAbi, 'getValidatorBasicInfo', [op]);
    await alert(state, `jailed-${op.toLowerCase()}`, jailed,
      `Validator ${op} is jailed. Anyone can move the vault's stake away from it (vault.redelegate). ${EXPLORER}/address/${op}`);
  }

  // Staking: idle BNB the keeper should have staked.
  const now = Date.now();
  if (idle >= BNB) state.idleSince ??= now;
  else delete state.idleSince;
  await alert(state, 'idle', state.idleSince && now - state.idleSince > 3600 * 1000,
    `${bnb(idle)} has been waiting unstaked for over an hour. Check the keeper, or press "Stake it now" on the website.`);

  // Keeper: running, funded, and not spending more than staking costs.
  const logAgeMin = existsSync(KEEPER_LOG) ? (now - statSync(KEEPER_LOG).mtimeMs) / 60000 : Infinity;
  await alert(state, 'keeper-stopped', logAgeMin > 30,
    Number.isFinite(logAgeMin)
      ? `Keeper has not reported for ${Math.round(logAgeMin)} minutes. Is ladder-keeper running?`
      : `Keeper log not found at ${KEEPER_LOG}. Is ladder-keeper running?`);
  await alert(state, 'keeper-low', keeperBal < KEEPER_LOW,
    `Keeper gas is low: ${bnb(keeperBal, 5)}. Send about 0.01 BNB to ${ADDR.keeper}.`);
  if (state.keeperBal != null && BigInt(state.keeperBal) - keeperBal > KEEPER_MAX_SPEND_PER_CHECK) {
    await send(`🚨 CRITICAL: Keeper wallet spent ${bnb(BigInt(state.keeperBal) - keeperBal, 5)} in 5 minutes, far more than staking costs. Its key may be compromised. ${EXPLORER}/address/${ADDR.keeper}`);
  }
  state.keeperBal = keeperBal.toString();

  // Deploy wallet: retired after four transactions. Anything more means its key is being used.
  if (state.deployerNonce == null) state.deployerNonce = deployerNonce;
  await alert(state, 'deployer', deployerNonce !== state.deployerNonce || (state.deployerBal != null && deployerBal < BigInt(state.deployerBal)),
    `The retired deploy wallet ${ADDR.deployer} sent a transaction. It has no role in the contracts, but its key may be exposed. ${EXPLORER}/address/${ADDR.deployer}`,
    'CRITICAL');
  state.deployerBal ??= deployerBal.toString();

  // Capacity.
  const capped = cap < 2n ** 255n;
  await alert(state, 'cap', capped && totalAssets * 100n >= cap * 90n,
    `Pool is ${capped ? Number((totalAssets * 1000n) / cap) / 10 : 0}% full (${bnb(totalAssets, 2)} of ${bnb(cap, 0)} cap). New deposits will be refused until the cap rises next month.`,
    'INFO');

  // Governance: announce new proposals and ones about to execute.
  for (let i = 0n; i < proposalCount; i++) {
    const [id, targets, values, calldatas] = await read(ADDR.governor, governorAbi, 'proposalDetailsAt', [i]);
    const key = id.toString();
    const st = Number(await read(ADDR.governor, governorAbi, 'state', [id]));
    const seen = state.proposals[key];
    if (seen?.state === st) continue;
    const title = (await read(ADDR.governor, governorAbi, 'proposalDescription', [id])).split('\n')[0].replace(/^#\s*/, '');
    const actions = targets.map((t, k) => `  • ${describeAction(t, values[k], calldatas[k])}`).join('\n');
    const link = `${SITE}/app/dao`;
    if (!seen) {
      const deadline = await read(ADDR.governor, governorAbi, 'proposalDeadline', [id]);
      await send(`🗳 New DAO proposal #${Number(i) + 1}: "${title}"\nIt would:\n${actions}\nVoting ends ${when(deadline)}. Depositors should vote: ${link}`);
    } else if (STATES[st] === 'Succeeded') {
      const [against, forVotes, abstain] = await read(ADDR.governor, governorAbi, 'proposalVotes', [id]);
      const cast = against + forVotes + abstain || 1n;
      const pct = (x) => `${Number((x * 1000n) / cast) / 10}%`;
      await send(`✅ DAO proposal #${Number(i) + 1} PASSED: "${title}" (for ${pct(forVotes)}, against ${pct(against)}, abstain ${pct(abstain)})\nIt would:\n${actions}\nOnce queued it can execute after 2 days. ${link}`);
    } else if (STATES[st] === 'Queued') {
      const eta = await read(ADDR.governor, governorAbi, 'proposalEta', [id]);
      await send(`⏳ DAO proposal #${Number(i) + 1} queued: "${title}". Anyone can execute it from ${when(eta)}.\nIt will:\n${actions}\n${link}`);
    } else if (STATES[st] === 'Executed') {
      await send(`📌 DAO proposal #${Number(i) + 1} executed: "${title}".`);
    } else if (seen && ['Defeated', 'Canceled', 'Expired'].includes(STATES[st])) {
      await send(`DAO proposal #${Number(i) + 1} ${STATES[st].toLowerCase()}: "${title}".`);
    }
    state.proposals[key] = { state: st };
  }
}

async function summary(snap) {
  const lines = [
    '📊 Daily summary',
    `Pool: ${bnb(snap.totalAssets ?? 0n, 4)} (cap ${snap.cap >= 2n ** 255n ? 'none' : bnb(snap.cap, 0)})`,
    `Staked: ${bnb(snap.staked ?? 0n, 4)} · waiting: ${bnb(snap.idle ?? 0n, 4)}`,
    `Treasury fee shares: ${bnb(snap.feeValue ?? 0n, 6)}`,
    `DAO proposals so far: ${snap.proposalCount ?? 0n} · claims so far: ${snap.claimCount ?? 0n}`,
    `Keeper gas: ${bnb(snap.keeperBal ?? 0n, 5)}`,
  ];
  await send(lines.join('\n'));
}

// ---------------------------------------------------------------- main

async function pass(state) {
  const snapshot = {};
  await checkSite(state);
  try {
    await checkChain(state, snapshot);
    state.rpcFails = 0;
  } catch (e) {
    state.rpcFails = (state.rpcFails || 0) + 1;
    log(`chain check failed (${state.rpcFails}): ${(e.shortMessage || e.message).split('\n')[0]}`);
  }
  await alert(state, 'rpc', (state.rpcFails || 0) >= 6, 'Cannot read BNB Chain for 30 minutes (RPC down?). On-chain checks are paused.');
  const today = new Date().toISOString().slice(0, 10);
  if (new Date().getUTCHours() === SUMMARY_HOUR && state.lastSummary !== today && snapshot.totalAssets != null) {
    await summary(snapshot);
    state.lastSummary = today;
  }
  state.lastRun = new Date().toISOString();
  saveState(state);
  return snapshot;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--find-chat')) {
    const token = readEnvFile().TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error(`set TELEGRAM_BOT_TOKEN in ${ENV_FILE} first`);
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const body = await res.json();
    if (!body.ok) throw new Error(`Telegram refused the token: ${body.description}`);
    const chats = new Map();
    for (const u of body.result) {
      const chat = (u.message || u.channel_post || u.my_chat_member)?.chat;
      if (chat) chats.set(chat.id, chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username);
    }
    if (chats.size === 0) log('no chats yet: send any message to your bot (or post in the group/channel), then run again');
    for (const [id, name] of chats) log(`TELEGRAM_CHAT_ID=${id}   (${name})`);
    return;
  }
  if (args.has('--test-alert')) {
    const ok = await send('🔔 Test alert: monitoring is connected. You will hear from me when something needs attention.');
    log(ok ? 'test message delivered' : 'test message NOT delivered (check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)');
    process.exit(ok ? 0 : 1);
  }
  const state = loadState();
  if (args.has('--summary')) {
    const snap = await pass(state);
    await summary(snap);
    return;
  }
  log(`monitor started: ${SITE}, vault ${ADDR.vault}, telegram ${readEnvFile().TELEGRAM_BOT_TOKEN ? 'configured' : 'NOT configured (log only)'}`);
  for (;;) {
    try {
      await pass(state);
      log(`pass ok; open alerts: ${Object.keys(state.alerts).join(', ') || 'none'}`);
    } catch (e) {
      log(`pass failed: ${e.message}`);
    }
    if (args.has('--once')) return;
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((e) => {
  log(`fatal: ${e.message}`);
  process.exit(1);
});
