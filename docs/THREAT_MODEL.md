# Threat model

Legacy Ladder holds other people's money for ten years, and they cannot leave early. That single fact
changes how security has to work, so it comes first.

## The fact that shapes everything

In most DeFi protocols, a governance timelock protects users: if someone schedules a harmful change, users
withdraw before it takes effect. **Here, depositors cannot withdraw for ten years. A timelock protects no one.**
Any power to redirect funds is, in practice, power to take them.

So the rule for this codebase is: **no key, role, multisig or vote can move, redirect, pause or freeze
deposits.** Not the team's, not a future DAO's. Where a role exists at all, the worst it can do must be bounded
and must not reach principal.

## What we promise, and how each promise is enforced

| Promise | Enforced by |
|---|---|
| Nobody can take deposits | No owner or admin over funds. Deposits can only go to BNB Chain's StakeHub system contract, fixed in bytecode. Contracts are immutable: no proxy, no upgrade path. |
| Nothing unlocks early | Maturity is checked in the vault for every redemption path. Bucket A shares cannot be transferred at all. |
| A market bug cannot reach the 70% | The vault itself refuses any transfer of bucket A shares, whoever calls it. The market contract can only ever move bucket B. |
| Withdrawals do not depend on us | No keeper, bot, admin action or website is required. Every step is callable by anyone, including the owner from a block explorer. |
| Payouts from StakeHub cannot get stuck in the vault | StakeHub forwards only 5,000 gas when paying out an unbond. The vault's `receive()` does nothing, and a fork test proves claims succeed at that stipend. |
| An early bug hits a small amount | Deposit caps are written into the bytecode and rise on a fixed schedule. No admin can raise them. |
| A seller can change their mind | The market's seven-day cooling-off: only the seller can cancel, and nothing can stop them doing so within it. |
| Neither side of a sale can trap the other | Shares and payment are collected separately, each to an address the collector chooses. |
| A sale can always be finished | If shares mature before collection they become a vault claim for the buyer; worthless shares close the sale. |
| The DAO can only spend the treasury | The treasury holds nothing but fee shares and what they redeem into. No vault role reaches deposits; a unanimous vote to take a depositor's shares is tested and fails. |
| Votes cannot be bought after the fact | Voting power is read at the second a proposal is created, from checkpoints the vault writes on every share movement. |

## Risks code cannot remove

These must be stated plainly to depositors.

- **BNB Chain itself.** StakeHub's `delegate`, `undelegate` and `claim` all carry `whenNotPaused` and
  `notInBlackList`, controlled by BNB Chain governance. BNB Chain can also change system contracts by hard fork.
  Every BSC staker carries this. Mitigation: spread stake across validators, and an **opt-in** migration path
  (below). Not removable.
- **Validator misbehaviour.** In BNB Chain's current StakeHub, slashing burns only the validator's own
  self-delegated stake, so delegators' share value does not fall (verified in source and pinned by a test). The
  real cost of a bad validator is lost rewards while it is jailed; anyone can move the vault's stake away from a
  jailed validator. If BNB Chain ever changes slashing to reach delegators, that loss would be shared by all
  depositors through the share price.
- **Lost keys.** The protocol holds no keys and keeps no beneficiary register. Owners who want recovery or
  inheritance should hold their position from a multisig or smart account.
- **Asset price.** BNB can fall, or fail entirely.
- **Stablecoin issuers.** Market payments are held in USDT or USDC. USDC on BNB Chain is an upgradeable proxy
  (verified on-chain), so its issuer could add freezing. If an issuer froze the market's address, payments escrowed
  in that token could not be released. Shares and BNB are unaffected.
- **Governance capture of the treasury.** Anyone holding enough of the pool, alone or with others, can pass a
  proposal if turnout is low: quorum is 10% of all votes and for-votes only need to beat against-votes. There is **no
  spending cap**, by the owner's decision, so a captured vote can send the whole treasury anywhere after the 2-day
  timelock, or first lower the quorum or delay by vote. Depositors' only defence is to vote against within the
  7-day voting period. A captured DAO is also the curator, so it could list poor validators and move stake to them,
  at most 10% of staked BNB per 7 days: rewards could suffer, principal could not be taken. Deposits are out of
  governance's reach.
- **Slow validator changes.** The curator is the DAO, so routine validator changes take at least 9 days (7 days of
  voting and a 2-day timelock). The urgent case, a jailed validator, needs no vote: anyone may move stake away from
  it immediately.
- **Governance stalling.** If turnout never reaches quorum, nothing passes. Fee shares keep accumulating in the
  treasury and keep their value; nothing is lost, but nothing is spent.
- **Contract bugs.** Reduced by minimal code, tests, audits and caps. Never zero.

## If BNB Chain breaks the staking interface

Because nothing can be upgraded, a breaking change to StakeHub could strand the integration. The planned answer
is **opt-in, per-position migration**: an owner may move their own position, with its maturity unchanged, to a
new audited vault. No position moves without its owner's signature. Design of this path is open; see
[DESIGN.md](DESIGN.md).

## Verified assumptions about StakeHub

Pinned by `contracts/test/fork/StakeHubAssumptions.t.sol` against a live mainnet fork:

- Minimum delegation is 1 BNB; undelegation has **no** minimum.
- Unbonding takes 7 days; claiming earlier reverts.
- Unbond payouts carry a 5,000 gas stipend; a receiver that writes storage makes the claim revert.
- Validator credit tokens cannot be transferred.
- Many small unbond requests can be claimed in bounded batches.
- Jailed validators refuse new delegation.

From source review of `bsc-genesis-contract` (not testable directly): validators are never removed from the
validator set, so stake can always be undelegated; undelegating from a jailed validator is allowed;
StakeCredit's share conversions **revert** for a validator with no shares, so the vault never asks for the value of
a position it does not hold.

## Hazards found while building the vault

Each of these is now prevented in code and covered by a test.

| Hazard | What would have happened | Prevention |
|---|---|---|
| 5,000 gas unbond payout | Any bookkeeping in `receive()` makes every StakeHub payout revert: withdrawals stuck forever | `receive()` is empty; bookkeeping happens in the function that triggered the claim |
| StakeCredit reverts on empty validators | One listed validator with zero shares would make `totalAssets()` revert: every deposit **and claim** blocked | Validators where the vault holds no shares are skipped before any conversion |
| Fee recipient rejecting ERC-1155 | Fees accrue on every deposit and claim; a recipient that rejects the mint callback would block both | Fee shares are credited without the receiver callback |
| Rounding surplus vs. reserved liquidity | Found by the invariant fuzzer: a 1-wei unbond surplus let `flush` delegate BNB an instant claim was waiting on | Explicit `reservedLiquidity`; withdrawals pay only from it; surplus is applied before unbonding more |
| Liquidity for the last claimant | Applying the surplus wrongly left the final claimant 1 wei short of stake | `idle + surplus + staked` always equals the pool, and no claim exceeds the pool |
| Dust sale maturing in escrow | Found by the market fuzzer: a 1-share sale that matured before collection became a claim worth 0 wei, which the vault refuses, so the buyer's collection could never succeed | Minimum sale value; worthless shares close the sale instead of reverting |
| EIP-7702 wallets | A wallet whose delegate lacks the ERC-1155 hook could not deposit or buy (found when a mainnet test address turned out to be 7702-delegated) | Hook skipped for 7702-delegated accounts only |
| Cross-party blocking | A blacklisted seller or a buyer that cannot hold shares would otherwise freeze the other side of the sale | Independent, redirectable collection for each side |

## Test evidence

- Unit tests for every promise in the table at the top.
- Invariant fuzzing: random sequences of deposits, flushes, rewards, slashing, losses, jailing, maturity jumps,
  claims, withdrawals, rescues and donations. After every step: claims covered by earmarked BNB, reserved BNB
  physically held, unbonding equal to StakeHub's queues to the wei, no early redemption, retirement shares never
  moved, high-water mark never falling, matured claims never reverting, ready withdrawals always paying. After every
  run, every holder withdraws everything.
- Market invariant fuzzing: random offers, partial fills, cancels, collections, refunds, token blacklisting and jumps
  around maturity. After every step: every stablecoin and escrowed share accounted for, cancels and collections never
  blocked, refunds always possible. After every run, the market holds nothing of value.
- Both fuzz handlers run with `fail_on_revert`: an unexpected revert anywhere fails the suite.
- The full ten-year lifecycle against BNB Chain's real StakeHub on a mainnet fork.
- A complete sale settled in real USDT on a mainnet fork.
- The deployment script run against a mainnet fork with real validators, USDT and USDC, and refusing a plain-wallet
  curator.
- Voting power: unit tests (deposits, history, fee shares, claims, market escrow) and a fuzzed invariant in both
  suites that every holder's votes equal their shares and the recorded total equals all voting shares.
- DAO: the full proposal lifecycle, quorum and against-vote defeats, the proposal threshold, deposits after a proposal
  carrying no weight, no double voting through the market, the late-quorum extension, the timelock refusing everyone
  but the governor, settings changeable only by vote, handing the treasury to a new DAO, and a unanimous vote failing
  to move a deposit. A complete vote on a mainnet fork against real staked deposits.

## Before any mainnet deposit

- [ ] Unit, fuzz and invariant tests for every promise above
- [ ] Symbolic checks of the core invariants
- [ ] At least two independent audits, findings published
- [ ] Public bug bounty funded before launch
- [ ] Contracts verified on BscScan; deployment reproducible from this repository
