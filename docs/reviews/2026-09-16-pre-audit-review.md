# Pre-audit review, 16 September 2026

An internal, AI-assisted security review of the v1 deployment (commit `6e8250a`, deployed to BNB Smart Chain on
14 September 2026) by a reviewer that had not written the code. **It is not an independent audit.** Findings were
confirmed against BNB Chain's real `StakeCredit` source and on a mainnet fork before being acted on. The v1 vault held
no deposits when this was found; the website stopped taking deposits the same day.

| ID | Severity | Finding | Status in v2 |
|---|---|---|---|
| H-1 | High | Every withdrawal first called `StakeCredit.claimableUnbondRequest`, which scans every claimable unbond request with no bound. Flooding the queue with small claims (about 247k gas each) grows withdrawal gas by about 9,600 per request; past about 7,300 requests every withdrawal and `collect` exceeds the 70M block gas limit, freezing all withdrawals permanently. Measured on a mainnet fork: 1.40M gas at 100 requests, 4.27M at 400. | Fixed. `_collect` reads only the head of the queue (`unbondRequest(vault, 0)`) and claims at most 50 per validator per call; `withdraw` collects only when the reserve cannot already pay; claims below 0.001 BNB are refused unless they redeem the caller's whole balance. Fork test: 187k gas for the worst withdrawal with 200 queued requests. |
| M-1 | Medium | Because `withdraw` always collected first, a StakeHub pause or blacklist also blocked BNB already reserved in the vault. | Fixed. Collection is skipped when the reserve covers the claim, and a refused StakeHub claim is skipped rather than reverting. |
| M-2 | Medium | While depositors are few, one depositor can pass DAO votes alone, including handing the fee-recipient and curator roles away permanently or changing the timelock. | Open: the DAO design is being revisited separately. |
| L-1 | Low | A donation before the first deposit makes shares coarse (0.01 BNB deposits revert, small ones lose value), and a gain too small to mint a fee share still moved the high-water mark. | Fixed. A 0.001 BNB seed is minted at deployment to a dead address (fee-bucket shares: no votes, never redeemable); the high-water mark only moves when a fee is minted. |
| L-2 | Low | A jailed-validator rescue could leave 1 share behind, blocking the validator's removal forever. | Fixed. A rescue always moves the vault's whole stake. |
| L-3 | Low | A ready withdrawal can briefly revert until enough batches are collected, or after BNB Chain shortens the unbond period. | Mitigated: `collect()` (anyone) pulls the next batch; the website should call it before retrying. |
| L-4 | Low | A deposit in a later block with the same timestamp as a proposal counted toward it. | Fixed. Voting power at a timepoint is what was held before that second began. |
| L-5 | Low | A market seller can accept a whole offer and cancel within the cooling-off if the price moves. | By design (the cooling-off protects sellers); buyers are warned. |
| L-6 | Low | Donations and rewards count toward the deposit cap. | Accepted. |
| L-7 | Low | The curator's 10% per 7 days limit uses fixed windows, so up to 20% can move within seconds at a boundary. | Accepted; revisit with the DAO design. |

Checked with no issue: the accounting identity and claim coverage, rounding surplus, unbond tracking, the undelegation
loop, fee maths, pricing and donations, the redelegate fee, jailed rescue, reentrancy, share-transfer rules and the
EIP-7702 check, vote checkpoints, governor and timelock wiring, the deploy script, market escrow, the inflation attack,
and gas bounds on validator loops.
