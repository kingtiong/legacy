// Staking keeper: stakes the vault's idle BNB by calling its public flush() once at least the StakeHub minimum
// (1 BNB) is waiting. flush() takes no arguments and sends nothing but gas, so this wallet can never move anyone's
// funds; the worst a compromised keeper key can do is spend its own gas money.
//
// Signing stays in Foundry: the key lives in an encrypted cast keystore and never enters this process.
//
//   VAULT_ADDRESS=0x... KEEPER_ACCOUNT=legacy-ladder-keeper \
//   KEEPER_PASSWORD_FILE=/root/.foundry/keystores/legacy-ladder-keeper.password node scripts/keeper.mjs
//
// Optional: RPC_URL (default bsc-dataseed), INTERVAL_SECONDS (600), MAX_GAS_GWEI (1), ONCE=1 (single pass).
// Local fork testing only: KEEPER_UNLOCKED_FROM=0x... signs with anvil's unlocked accounts, refused unless RPC_URL is
// on localhost.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createPublicClient, formatEther, formatGwei, getAddress, http, parseGwei } from 'viem';
import { bsc } from 'viem/chains';

const VAULT = process.env.VAULT_ADDRESS;
const RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed.bnbchain.org';
const INTERVAL = Number(process.env.INTERVAL_SECONDS || 600) * 1000;
const MAX_GAS = parseGwei(process.env.MAX_GAS_GWEI || '1');
const ACCOUNT = process.env.KEEPER_ACCOUNT;
const PASSWORD_FILE = process.env.KEEPER_PASSWORD_FILE;
const UNLOCKED_FROM = process.env.KEEPER_UNLOCKED_FROM;
const CAST = process.env.CAST_BIN || `${homedir()}/.foundry/bin/cast`;
const LOW_BALANCE = 2n * 10n ** 15n; // warn below 0.002 BNB

const log = (...a) => console.log(new Date().toISOString(), ...a);

if (!/^0x[0-9a-fA-F]{40}$/.test(VAULT || '')) throw new Error('VAULT_ADDRESS is required');
const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC_URL);
if (UNLOCKED_FROM && !local) throw new Error('KEEPER_UNLOCKED_FROM is for a local fork only');
if (!UNLOCKED_FROM && !(ACCOUNT && PASSWORD_FILE)) throw new Error('KEEPER_ACCOUNT and KEEPER_PASSWORD_FILE are required');

const abi = [
  { type: 'function', name: 'delegatableBnb', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'STAKE_HUB', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'flush', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'address' }, { type: 'uint256' }] },
];
const hubAbi = [
  { type: 'function', name: 'minDelegationBNBChange', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const client = createPublicClient({ chain: bsc, transport: http(RPC_URL) });

function keeperAddress() {
  if (UNLOCKED_FROM) return getAddress(UNLOCKED_FROM.toLowerCase());
  return getAddress(execFileSync(CAST, ['wallet', 'address', '--account', ACCOUNT, '--password-file', PASSWORD_FILE], {
    encoding: 'utf8',
  }).trim().toLowerCase());
}

async function pass(from) {
  const [idle, hub, balance, gasPrice] = await Promise.all([
    client.readContract({ address: VAULT, abi, functionName: 'delegatableBnb' }),
    client.readContract({ address: VAULT, abi, functionName: 'STAKE_HUB' }),
    client.getBalance({ address: from }),
    client.getGasPrice(),
  ]);
  const min = await client.readContract({ address: hub, abi: hubAbi, functionName: 'minDelegationBNBChange' });
  if (balance < LOW_BALANCE) log(`WARNING keeper balance low: ${formatEther(balance)} BNB at ${from}`);
  if (idle < min) return log(`idle ${formatEther(idle)} BNB, below the ${formatEther(min)} BNB minimum`);
  if (gasPrice > MAX_GAS) return log(`gas ${formatGwei(gasPrice)} gwei above the ${formatGwei(MAX_GAS)} gwei limit, waiting`);

  // Simulate first: a revert (e.g. every validator jailed) costs nothing and is logged instead of sent.
  try {
    const { result } = await client.simulateContract({ address: VAULT, abi, functionName: 'flush', account: from });
    log(`staking ${formatEther(result[1])} BNB with ${result[0]}`);
  } catch (e) {
    return log(`flush would revert: ${e.shortMessage || e.message}`);
  }

  const auth = UNLOCKED_FROM
    ? ['--from', UNLOCKED_FROM, '--unlocked']
    : ['--account', ACCOUNT, '--password-file', PASSWORD_FILE];
  const out = execFileSync(
    CAST,
    ['send', VAULT, 'flush()', '--rpc-url', RPC_URL, '--gas-price', gasPrice.toString(), '--json', ...auth],
    { encoding: 'utf8' }
  );
  const receipt = JSON.parse(out);
  log(`tx ${receipt.transactionHash} status ${receipt.status} gas ${BigInt(receipt.gasUsed)}`);
}

async function main() {
  const from = keeperAddress();
  log(`keeper ${from} watching vault ${VAULT}${local ? ' (local fork)' : ''}`);
  let checked = false;
  for (;;) {
    try {
      if (!checked) {
        const chainId = await client.getChainId();
        if (chainId !== 56) throw new Error(`RPC is chain ${chainId}, expected 56`);
        checked = true;
      }
      await pass(from);
    } catch (e) {
      log(`pass failed: ${(e.shortMessage || e.message || String(e)).split('\n')[0]}`);
    }
    if (process.env.ONCE) return;
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((e) => {
  log(`fatal: ${e.message}`);
  process.exit(1);
});
