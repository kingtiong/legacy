# Design (v1, BNB Smart Chain)

Status: **deployed to BNB Smart Chain mainnet on 2026-09-14 ([addresses](../deployments/bsc-mainnet.md)). Not audited.**

## Components

| Contract | Role | Mutable? |
|---|---|---|
| `LadderVault` | Deposits, monthly cohort shares (ERC-1155), 70/30 split, maturity, claims, fee, staking via StakeHub | Immutable, no owner |
| `CohortMarket` | Escrowed sale of emergency shares for USDT or USDC, with a seven-day cooling-off | Immutable, no owner; two fixed fees to the DAO |
| `TimelockController` (OpenZeppelin) | The DAO treasury: the vault's fee recipient, executes passed proposals after 2 days | No admin; changes only through its own proposals |
| `LadderGovernor` | Depositor voting on the treasury (OpenZeppelin Governor) | Settings changeable only by a passed vote |

There is deliberately no adapter layer: pluggable adapters would let governance redirect funds depositors
cannot pull back. See [THREAT_MODEL.md](THREAT_MODEL.md).

## Decided

- **Chain:** BNB Smart Chain first. Ethereum later, as an independent deployment.
- **Staking:** BNB Chain native staking through StakeHub (`0x0000000000000000000000000000000000002002`).
- **Cohorts:** fixed epochs of 2,629,746 s (the average Gregorian month) from deployment. A deposit in epoch *e*
  matures at the end of epoch *e* + 120: at least ten years, at most ten years and one month.
- **Shares:** ERC-1155, id `(cohort << 2) | bucket`. Bucket 0 retirement (≥70%, never transferable), bucket 1
  emergency (≤30%, transferable only by the market, only before maturity). Id 2 holds fee shares, unlocked.
- **Yield:** stays in the pool and raises the share price.
- **Fee:** 30% of gain above a high-water mark, minted as fee shares without the receiver callback. The fee
  recipient is the DAO treasury from deployment. Only the current recipient can hand the role on (by a passed
  vote); nobody else can change it.
- **DAO:** depositors govern the treasury. See "How the DAO works" below.
- **Curator:** the DAO treasury (so validator changes happen only by depositor vote). It can list validators (existing, not jailed, at most 16), remove ones the vault holds
  nothing with, and redelegate between listed validators up to 10% of staked BNB per 7 days. It cannot withdraw or
  send BNB anywhere. Anyone may move stake away from a jailed validator, without limit.
- **Launch limits** (immutable, set in `script/Deploy.s.sol`), chosen for launching **without an audit**: deposits of
  0.01 to 10 BNB; pool capped at 100 BNB, rising 50 BNB per epoch, cap removed after 36 epochs (about three years).
- **Launch validators:** Ankr (`0xeace…FbE4`, commission capped at 10% for ever), Figment (`0x477c…0D68`), NodeReal
  (`0x7d0F…Fa31`) and The48Club (`0xaACc…de48`): established, publicly identifiable operators, unjailed and over two
  years old. `script/ValidatorReport.s.sol` re-runs the comparison.
- **No team roles:** the DAO treasury is both fee recipient and curator from deployment. No team wallet or multisig
  holds any role in any contract.
- **Deployment safety:** timelock, vault, market and governor are deployed as four consecutive
  transactions with predicted addresses; the market and governor refuse to deploy unless wired to exactly the
  contracts that expect them, and the script re-checks every address and role at the end.
- **No migration in v1.** Validator credits cannot be transferred, so moving a position means undelegating through
  StakeHub, which is exactly what a breaking StakeHub change would impair; and any list of approved migration
  targets would reintroduce a power over funds. Depositors are told plainly that a breaking BNB Chain change to
  staking is a risk the protocol cannot engineer away.
- **EIP-7702 wallets:** the ERC-1155 receiver hook is skipped for addresses carrying a 7702 delegation designator.
  Such an account is controlled by its key whatever code it delegates to, so it can always redeem directly; the
  hook would only lock out users whose wallet code lacks it. Real contracts keep the standard check.
- **Share pricing:** virtual shares (1,000) and assets (1) against inflation attacks; all rounding favours the pool.
- **Licence:** MIT.

## How BNB moves (vault)

**Deposit.** BNB lands in the vault's balance and shares are minted at the current price. Anyone may call
`flush()`, which delegates idle BNB (at least StakeHub's 1 BNB minimum) to the listed, non-jailed validator
holding the least of the vault's stake.

**Staking keeper.** `scripts/keeper.mjs` calls `flush()` whenever at least 1 BNB is idle. It is a convenience, not a
dependency: `flush()` takes no arguments and moves no value, so the keeper's wallet holds only gas money and has no
power over deposits. If it stops, BNB waits unstaked (earning nothing) until anyone calls `flush()`, including from
the website's "Stake it now" button or a block explorer. It signs through an encrypted Foundry keystore, simulates
before sending, and skips rounds when gas is above its limit.

**Claim.** After maturity, `requestClaim` burns shares and fixes the BNB owed. The vault tracks:

- `outstandingClaims`: BNB owed to claims not yet withdrawn, excluded from the pool.
- `unbonding`: BNB in StakeHub's unbond queues on the vault's behalf.
- `reservedLiquidity`: BNB that must stay in the vault's balance for claims. `flush` never touches it.

If idle BNB covers the claim, it is reserved and the claim is ready immediately. Otherwise the claim takes the
idle BNB, then any surplus already earmarked (wei left over from rounding unbonds up), and unbonds the rest from the
most-staked validators; it is ready after the unbond period. BNB collected from StakeHub joins the reserve.

**Withdraw.** Anyone may trigger `withdraw(claimId)`, which first collects finished unbonds, then pays the owner
from the reserve. Only the owner can redirect a claim with `withdrawTo`, which also rescues an owner that cannot
receive BNB.

**Both at once.** `requestClaimMany(ids, shares)` and `withdrawMany(claimIds)` loop over the same code, entry by
entry, so every rule above still holds and one bad entry reverts the batch. They exist because a wallet asks to
confirm each transaction separately: without them a matured rung costs four confirmations (claim both buckets, then
withdraw both claims) and a saver who lets several rungs mature pays two more for each. They cost the vault's
bytecode, which is why the optimizer runs at 1,000 rather than 10,000 (see `foundry.toml`).

**Accounting identity.** `totalAssets = balance + staked + unbonding − outstandingClaims`, and at all times
`reservedLiquidity + unbonding ≥ outstandingClaims` and `balance ≥ reservedLiquidity`.

## How the DAO works

- **Who votes.** Every retirement and emergency share is one vote for whoever holds it. There is no delegation and no
  token: a ladder is a vote. Fee shares carry no votes, so the treasury can never vote with its own income. The
  market's escrow holds votes during a sale's cooling-off but never votes.
- **When power is counted.** The vault records each holder's votes over time (ERC-5805 reads on a timestamp clock).
  A proposal's votes are read at the second it was created (voting delay 0), so nobody can deposit after seeing a
  proposal and vote with it, and shares bought through the market cannot vote twice.
- **Rules at launch.** Proposing needs 1e21 shares (a ladder of about 1 BNB at launch). Voting runs 7 days. A proposal
  passes with more for than against and a quorum of 10% of all votes (for plus abstain). A vote that reaches quorum
  late runs at least 2 more days. A passed proposal waits 2 days in the timelock, then anyone may execute it.
- **What it can do.** Anything the treasury itself can do: redeem or grant fee shares, send the BNB it holds, list or
  remove validators and redelegate between them (still limited to 10% of stake per 7 days), hand either role to a new
  address, change its own settings. **No spending cap** (the owner's decision: a passed
  vote can move the whole treasury).
- **What it cannot do.** Move, redirect, pause or freeze deposits, change maturities, or stop withdrawals. The vault
  gives no role that power; a test runs a unanimous vote to take a depositor's shares and shows it fails.
- **Building blocks.** OpenZeppelin v5.6.1 Governor, GovernorSettings, GovernorCountingSimple, GovernorStorage (on-chain
  proposal list, so the website needs no indexer), GovernorVotes, GovernorVotesQuorumFraction,
  GovernorPreventLateQuorum and GovernorTimelockControl, composed without changes, plus stored descriptions.

## How a sale works (market)

1. **Offer.** A buyer escrows USDT or USDC for a number of emergency shares of one cohort, open to any holder or to
   a named seller, for up to 30 days. The buyer may withdraw what is unspent at any time.
2. **Accept.** A holder sells all or part (priced pro rata; the final fill takes exactly what is left). The sale must
   be worth at least 0.000001 BNB. Shares move into escrow and a seven-day cooling-off starts. Offers and acceptances
   close seven days before the cohort matures.
3. **Cancel.** Only the seller, only within the cooling-off, and only by paying `CANCEL_FEE_BPS` (3% of the price):
   half compensates the buyer for the days their money sat locked, half goes to the DAO. Shares return and the buyer
   becomes refundable for everything they paid plus that compensation. A seller who cannot or will not pay simply
   does not cancel, and the sale completes — so the right to change one's mind is real but never free, and cannot be
   used to lock a buyer's capital repeatedly.
4. **Collect.** After the cooling-off, the buyer collects shares and the seller collects payment, **each
   independently and to an address of their choosing**, so neither can block the other. The seller receives the
   agreed price untouched: `TRADE_FEE_BPS` (2%) was added on top of it when the buyer paid, and goes to the DAO when
   the sale completes. `settleFee` lets anyone hand the DAO its share of a sale whose seller never collects; a
   cancelled sale charges the buyer nothing.
5. **Maturity while waiting.** If the buyer collects after maturity, when shares can no longer move, the market
   redeems them into a vault claim that only the buyer can direct. Shares that have become worthless close the sale
   instead of leaving a collection that can never succeed.

6. **One hop only.** Shares bought here can never be sold again: `collectShares` records them against whoever
   receives them, and `listShares` and `acceptOffer` refuse to take them. Moving them to another wallet first
   changes nothing, because the vault lets emergency shares move only through this market. A holder who both saved
   and bought may still sell what they saved. The cost of this rule is the buyer's: they hold an illiquid position
   until maturity, and will price it accordingly.

The market only accepts shares it pulled itself, never holds retirement shares (the vault refuses to move them), and
rejects fee-on-transfer tokens. Both fee rates are fixed at deployment, capped in the constructor (3% trade, 5%
cancellation), and payable only to the DAO treasury: there is no admin who can change or redirect them.

**Deployment.** The vault's market address is immutable, so the deploy script predicts the market's address from the
deployer's nonce, deploys the vault with it, deploys the market, and checks the address matched. The market's
constructor also refuses to deploy anywhere the vault does not expect.

## Still open before launch

1. **Independent audits** of both contracts, findings published.
2. ~~Roles~~: decided. The DAO treasury is fee recipient and curator; launch validators are chosen (above).
3. **A funded bug bounty.**
4. **Deposit, claim and market screens** in the website: built and tested end to end against a mainnet fork.
5. **Re-evaluate the pinned OpenZeppelin release** against the latest audited version.

## Invariants enforced by the test suite

Vault:
1. No share is redeemed before its cohort's maturity.
2. Retirement shares never change owner.
3. `reservedLiquidity + unbonding ≥ outstandingClaims`.
4. `balance ≥ reservedLiquidity`.
5. `unbonding` equals the vault's StakeHub unbond queues to the wei.
6. A deposit is never worth more than was paid.
7. The high-water mark never falls while shares exist.
8. A matured claim never reverts (other than for dust too small to be worth any BNB).
9. A ready withdrawal always pays.
10. After any sequence, every holder can withdraw everything.

Market:
1. The market's balance of each stablecoin equals exactly what open offers, refunds and uncollected sales hold.
2. Escrowed shares equal exactly those of accepted, uncancelled, uncollected sales; retirement shares are never held.
3. A seller can always cancel within the cooling-off.
4. After the cooling-off, a buyer can always collect shares and a seller can always collect payment, whatever the
   other party's address does.
5. A buyer can always take back unspent money.
6. After any sequence, once everyone collects, the market holds nothing of value.
