# Legacy Ladder

A savings protocol for people paid in crypto. Lock a slice of what you earn each month for ten years, staked
while it waits, and receive it back month by month from year eleven.

> **Pre-launch.** Nothing is deployed to mainnet and nothing has been audited. Do not send funds to any address
> claiming to be Legacy Ladder.

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
