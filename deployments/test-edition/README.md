# Ten-hour test edition (BNB Smart Chain mainnet)

A **test** deployment for trying the whole product with small real BNB: identical code to the v2 vault, but each
"month" lasts 5 minutes, so a deposit unlocks after 120 of them: **10 hours**. Deposits of 0.001 to 0.05 BNB, at most
1 BNB in the pool. Website: https://decadium.club/test (red TEST banner, not indexed). **Not the Decadium product.**

Deployed 19 September 2026 with `forge script script/Deploy.s.sol:DeployTest` from commit
[`b427e43`](https://github.com/kingtiong/legacy/commit/b427e43), by the deploy-only wallet
`0x50EC98729acC0a72fdfb538E6ce6595131bACdeb`. Cost 0.00080 BNB of gas plus a 0.0001 BNB permanent seed. All four
contracts verified on Sourcify (exact match). Transaction record: `broadcast-run.json`.

| Contract | Address | Transaction |
|---|---|---|
| Test DAO treasury (`TimelockController`) | `0x8E7B12487bA7cf13ec292Bd79730d3CF91243889` | `0x2b06dbba960cb01805e17d9d010f885e3fcab62ed8ad6804d658c35f8fd8eac4` |
| Test `LadderVault` | `0x3949881291B46e83C643AedAAE45a312a58B542a` | `0x86eac1261a8550079289dd93e76d1a8e8ec27b6a85be5a1d0e727f69028dee75` |
| Test `CohortMarket` | `0x44dC601a9Ea949FD947EC7627e0bB6bE95728F94` | `0x2b61f8488a6e228621f6ddf42b3970fc80c1fe92691d036a534a39abd9cf8c1a` |
| Test `LadderGovernor` | `0x37b56B7DbA5f9DDd32136880b3C7e5f31f5B080D` | `0x0256d9b2259c6d7c1fbff3731f11ebae6f1b68f5a68ef5e00785cfe3ab57ab3c` |

Checked on-chain after deployment: `EPOCH` 300 s, `LOCK_EPOCHS` 120, `MAX_DEPOSIT` 0.05 BNB, `CAP_INITIAL` 1 BNB,
market and roles wired as in production, seed present. Genesis 1789777214.

What it does not shorten: the market's 7-day cooling-off, DAO voting (7 days) and timelock (2 days), and BNB Chain's
7-day unstaking (deposits under 1 BNB in total are never staked, so claims pay straight away).
