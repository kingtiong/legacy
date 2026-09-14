// Product name lives here only. Changing it renames the whole site.
export const NAME = 'Legacy Ladder';
export const TAGLINE = 'A savings protocol for people paid in crypto.';

// Public address of the site, used for absolute links in link previews.
export const SITE_URL = 'https://coreos.live/project21';

// Lock parameters, mirrored from the protocol spec.
export const LOCK_YEARS = 10;
export const LOCK_MONTHS = LOCK_YEARS * 12;
export const BUCKET_A_PCT = 70; // soulbound until maturity
export const BUCKET_B_PCT = 30; // tradeable on the secondary market
export const PROTOCOL_FEE_PCT = 30; // share of staking yield

export const ASSETS = {
  bnb: {
    key: 'bnb',
    symbol: 'BNB',
    chainName: 'BNB Smart Chain',
    chainId: 56,
    defaultPrice: 700,
    grossApr: 2.5,
  },
  eth: {
    key: 'eth',
    symbol: 'ETH',
    chainName: 'Ethereum',
    chainId: 1,
    defaultPrice: 3200,
    grossApr: 3.0,
  },
};
