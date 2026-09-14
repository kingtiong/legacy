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
| `src/interfaces/IStakeHub.sol` | The subset of BNB Chain's StakeHub the vault relies on |
| `script/Deploy.s.sol` | Deploys vault and market with the market address predicted and checked |
| `test/LadderVault.t.sol` | Vault unit tests, grouped by the promise each protects |
| `test/CohortMarket.t.sol` | Market unit tests |
| `test/invariant/` | Fuzzed action sequences and the invariants that must survive them, for each contract |
| `test/Regressions.t.sol` | Exact replays of sequences the fuzzer found |
| `test/fork/StakeHubAssumptions.t.sol` | Pins every StakeHub behaviour the design depends on |
| `test/fork/LadderVaultFork.t.sol` | The full ten-year lifecycle against the real StakeHub |
| `test/fork/CohortMarketFork.t.sol` | A complete sale settled in real USDT |
| `test/mocks/` | StakeHub, StakeCredit and a blacklistable, fee-capable stablecoin |

## Simulating a deployment

```bash
FEE_RECIPIENT=<safe> CURATOR=<safe> VALIDATORS=<op1,op2,op3> \
  forge script script/Deploy.s.sol --rpc-url https://bsc-dataseed.bnbchain.org --sender <address>
```

Without `--broadcast` nothing is sent. The script never handles private keys.

Dependencies (git submodules, exact tags): OpenZeppelin Contracts v5.6.1, forge-std v1.16.2.
