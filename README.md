# Decadium

*Time is the strategy.* (Formerly "Legacy Ladder"; the contracts keep their original names.)

A savings protocol for people paid in crypto. Lock a slice of what you earn each month for ten years, staked
while it waits, and receive it back month by month from year eleven.

> **Live on BNB Smart Chain, not audited.** The only official contracts are listed in
> [deployments/bsc-mainnet.md](deployments/bsc-mainnet.md). Do not send funds to any other address claiming to be
> Legacy Ladder.

## Repository

| Path | What |
|---|---|
| `contracts/` | Solidity contracts (Foundry). See `contracts/README.md`. |
| `docs/THREAT_MODEL.md` | What the protocol promises, how each promise is enforced, and what it cannot protect against. **Start here.** |
| `docs/DESIGN.md` | How the contracts work, what is decided and what is still open. |
| `app/`, `components/`, `lib/` | The website (Next.js). |

## Principles

1. Nobody, including the team, can move, redirect, pause or freeze deposits.
2. Withdrawals never depend on us, our website or any off-chain service.
3. Contracts that hold funds are immutable.
4. Protocol fees belong to a treasury that only depositors' votes can spend.

## Licence

MIT. See [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md). Contributions:
[CONTRIBUTING.md](CONTRIBUTING.md).
