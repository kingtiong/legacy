# BNB Smart Chain mainnet deployment

Deployed 2026-09-14 by `script/Deploy.s.sol` from commit
[`6e8250a`](https://github.com/kingtiong/legacy/commit/6e8250a), with the deploy-only wallet
`0x50EC98729acC0a72fdfb538E6ce6595131bACdeb`, which holds no role in any contract. All four contracts are verified on
Sourcify with an exact match. The full transaction record is `contracts/broadcast/Deploy.s.sol/56/run-latest.json`.

**Not audited.** Read [docs/THREAT_MODEL.md](../docs/THREAT_MODEL.md) before depositing.

| Contract | Address | Deployment transaction | Block |
|---|---|---|---|
| DAO treasury (`TimelockController`) | [`0x81D43e758CC917802DeFeA3A290D138302B8b8A2`](https://bscscan.com/address/0x81D43e758CC917802DeFeA3A290D138302B8b8A2) | [`0x024970c0…`](https://bscscan.com/tx/0x024970c0e6d17091718f2dffbc6cc4a001302658ed2a2009f8342844b412622d) | 121864588 |
| `LadderVault` | [`0x0C09EC94aDb65314448562B028FC5AfDBa421742`](https://bscscan.com/address/0x0C09EC94aDb65314448562B028FC5AfDBa421742) | [`0xc3467e71…`](https://bscscan.com/tx/0xc3467e7123110f643ee3c48959d741d841d932c5e6d8400ef822e4e6258915fd) | 121864592 |
| `CohortMarket` | [`0xCb4f25dD8E185e7B698a0DD48fE2b15861fAC8F1`](https://bscscan.com/address/0xCb4f25dD8E185e7B698a0DD48fE2b15861fAC8F1) | [`0x6f355bb0…`](https://bscscan.com/tx/0x6f355bb076c6bf49c3b400d8411c79bb602145306e356ce0a4a31a44a989c7a2) | 121864596 |
| DAO governor (`LadderGovernor`) | [`0xE398C073F29CcdaF5c03a0C19E3147c13B25991A`](https://bscscan.com/address/0xE398C073F29CcdaF5c03a0C19E3147c13B25991A) | [`0x94758a38…`](https://bscscan.com/tx/0x94758a38a05950c8381ced898d3f5655c2fc5bc947b752f1c3ac0b961da96c45) | 121864600 |

Source verification: `https://repo.sourcify.dev/56/<address>`.

## Checked on-chain after deployment

- Vault: market is the CohortMarket above; fee recipient and curator are both the DAO treasury; validators Ankr,
  Figment, NodeReal, The48Club; deposits 0.01 to 10 BNB; pool cap 100 BNB rising 50 BNB per epoch, removed after 36.
- Market: vault is the LadderVault above; payment tokens USDT `0x55d3…7955` and USDC `0x8AC7…580d`.
- Governor: votes from the vault; timelock is the DAO treasury; no voting delay, 7 day voting period, 10% quorum.
- Timelock: 2 day minimum delay; the governor is the only proposer; anyone may execute; the deploy wallet holds no
  proposer or admin role.
- Genesis (cohort 0 start): 1789400994. Deployment gas: 15,640,926 at 0.05 gwei, 0.00078 BNB.
