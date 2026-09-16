// Where the deployed contracts live: BNB Smart Chain mainnet, deployed 2026-09-14 from commit 6e8250a and verified on
// Sourcify (see deployments/bsc-mainnet.md). Environment variables override them for local fork testing.
export const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS || '0x0C09EC94aDb65314448562B028FC5AfDBa421742';
export const MARKET_ADDRESS = process.env.NEXT_PUBLIC_MARKET_ADDRESS || '0xCb4f25dD8E185e7B698a0DD48fE2b15861fAC8F1';
export const GOVERNOR_ADDRESS = process.env.NEXT_PUBLIC_GOVERNOR_ADDRESS || '0xE398C073F29CcdaF5c03a0C19E3147c13B25991A';
// The DAO treasury: the timelock that executes passed proposals, receives fee shares and curates validators.
export const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '0x81D43e758CC917802DeFeA3A290D138302B8b8A2';
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const LIVE = [VAULT_ADDRESS, MARKET_ADDRESS, GOVERNOR_ADDRESS, TREASURY_ADDRESS].every(isAddress);

// Emergency switch for the website only (the contracts cannot be paused). While on, the Deposit screen is replaced by a
// notice. Turned on 2026-09-16: a pre-audit review found that withdrawals in this deployment can be frozen by flooding
// the staking unbond queue; a fixed v2 will be deployed before deposits reopen. Override with NEXT_PUBLIC_DEPOSITS_PAUSED=0.
export const DEPOSITS_PAUSED = (process.env.NEXT_PUBLIC_DEPOSITS_PAUSED ?? '1') !== '0';

export const CHAIN_ID = 56;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://bsc-dataseed.bnbchain.org';
export const EXPLORER = 'https://bscscan.com';

// Payment tokens, in the order the market was deployed with (token index 0 and 1). Both 18 decimals on BSC.
export const PAYMENT_TOKENS = [
  { index: 0, symbol: 'USDT', address: process.env.NEXT_PUBLIC_TOKEN0_ADDRESS || '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  { index: 1, symbol: 'USDC', address: process.env.NEXT_PUBLIC_TOKEN1_ADDRESS || '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
];

// Browser tests connect a funded local account without a wallet extension.
export const E2E_ACCOUNT = process.env.NEXT_PUBLIC_E2E_ACCOUNT || '';

export const RETIREMENT = 0;
export const EMERGENCY = 1;
export const FEE_SHARES_ID = 2n;
export const shareId = (cohort, bucket) => (BigInt(cohort) << 2n) | BigInt(bucket);
export const cohortOf = (id) => BigInt(id) >> 2n;
export const bucketOf = (id) => Number(BigInt(id) & 3n);
