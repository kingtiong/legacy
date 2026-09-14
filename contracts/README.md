# Legacy Ladder contracts

Foundry project. Solidity 0.8.30, EVM `cancun`, optimizer 10,000 runs, all pinned in `foundry.toml`.

```bash
forge build
forge test --no-match-path "test/fork/*"   # unit, regression and invariant tests
forge test --match-path "test/fork/*"      # against a live BNB Chain mainnet fork (set BSC_RPC_URL for your own node)
FOUNDRY_PROFILE=ci forge test              # heavier fuzzing, as CI runs it
```

## Layout

| Path | What |
|---|---|
| `src/LadderVault.sol` | The vault. Read [docs/DESIGN.md](../docs/DESIGN.md) first. |
| `src/CohortMarket.sol` | The emergency-share market |
| `src/LadderGovernor.sol` | The depositor DAO; its treasury is an OpenZeppelin `TimelockController` |
| `src/interfaces/IStakeHub.sol` | The subset of BNB Chain's StakeHub the vault relies on |
| `script/Deploy.s.sol` | Deploys timelock, vault, market and governor, with addresses predicted and every role checked |
| `test/LadderVault.t.sol` | Vault unit tests, grouped by the promise each protects |
| `test/CohortMarket.t.sol` | Market unit tests |
| `test/LadderGovernor.t.sol` | Voting power and DAO tests |
| `test/invariant/` | Fuzzed action sequences and the invariants that must survive them, for each contract |
| `test/Regressions.t.sol` | Exact replays of sequences the fuzzer found |
| `test/fork/StakeHubAssumptions.t.sol` | Pins every StakeHub behaviour the design depends on |
| `test/fork/LadderVaultFork.t.sol` | The full ten-year lifecycle against the real StakeHub |
| `test/fork/CohortMarketFork.t.sol` | A complete sale settled in real USDT |
| `test/fork/DeployFork.t.sol` | The launch stack and a complete DAO vote against real staked deposits |
| `test/mocks/` | StakeHub, StakeCredit and a blacklistable, fee-capable stablecoin |

## Simulating a deployment

```bash
CURATOR=<safe> \
  forge script script/Deploy.s.sol --rpc-url https://bsc-dataseed.bnbchain.org --sender <address>
```

Without `--broadcast` nothing is sent. The script never handles private keys.

Dependencies (git submodules, exact tags): OpenZeppelin Contracts v5.6.1, forge-std v1.16.2.
