// Where the deployed contracts live. Addresses are baked in at build time; until they are set the app pages show a
// launching-soon state instead of talking to nothing.
export const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS || '';
export const MARKET_ADDRESS = process.env.NEXT_PUBLIC_MARKET_ADDRESS || '';
export const GOVERNOR_ADDRESS = process.env.NEXT_PUBLIC_GOVERNOR_ADDRESS || '';
// The DAO treasury: the timelock that executes passed proposals and receives the protocol's fee shares.
export const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '';
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const LIVE = [VAULT_ADDRESS, MARKET_ADDRESS, GOVERNOR_ADDRESS, TREASURY_ADDRESS].every(isAddress);

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
