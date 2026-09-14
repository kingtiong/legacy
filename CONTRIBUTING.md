# Contributing

Ideas, questions and code are all welcome.

- **Ideas and questions:** open a GitHub Discussion or an issue.
- **Security problems:** never in public. See [SECURITY.md](SECURITY.md).
- **Code:** open a pull request against `main`.

## Ground rules for contract changes

Read [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) first. A change will not be merged if it:

- gives any key, role or vote the ability to move, redirect, pause or freeze deposits;
- adds an upgrade path to a contract that holds funds;
- makes a withdrawal depend on an off-chain actor.

Every change to `contracts/src` needs tests, and any change to accounting needs an invariant test.

## Working on the contracts

```bash
cd contracts
forge build
forge test                              # unit, fuzz and invariant tests
forge test --match-path "test/fork/*"   # against a BNB Chain mainnet fork (set BSC_RPC_URL for your own node)
```

Dependencies are git submodules pinned to exact releases. Clone with `git clone --recursive`.

## Working on the website

```bash
npm install
npm run dev
```
