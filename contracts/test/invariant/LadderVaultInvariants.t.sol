// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {MockStakeHub, MockStakeCredit} from "../mocks/MockStakeHub.sol";
import {VaultTestBase} from "../utils/VaultTestBase.sol";

/// @notice Drives the vault through random sequences of real actions and records any broken promise.
contract VaultHandler is Test {
    LadderVault internal immutable vault;
    MockStakeHub internal immutable hub;
    address internal immutable market;
    address internal immutable curator;
    address internal immutable feeRecipient;
    address[3] internal vals;
    address[] internal actors;

    uint256[] public claimIds;
    uint256[] internal cohorts;
    mapping(uint256 => bool) internal seenCohort;
    mapping(address => mapping(uint256 => uint256)) public expectedRetirement;

    // Broken-promise counters. Every one must stay zero.
    uint256 public earlyClaimSucceeded;
    uint256 public retirementMoved;
    uint256 public retirementBalanceDrift;
    uint256 public highWaterMarkFell;
    uint256 public depositOverpaid;
    uint256 public maturedClaimReverted;
    uint256 public readyWithdrawalFailed;
    bytes4 public lastUnexpectedRevert;

    uint256 internal lastHwm;
    uint256 public calls;

    // Coverage counters: proof that the important paths actually run.
    uint256 public maturedClaims;
    uint256 public unbondedClaims;
    uint256 public withdrawals;
    uint256 public successfulFlushes;
    uint256 public rescues;

    constructor(
        LadderVault vault_,
        MockStakeHub hub_,
        address market_,
        address curator_,
        address fee_,
        address[3] memory vals_
    ) {
        vault = vault_;
        hub = hub_;
        market = market_;
        curator = curator_;
        feeRecipient = fee_;
        vals = vals_;
        for (uint256 i; i < 4; ++i) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
        lastHwm = vault.highWaterMark();
    }

    modifier tracked() {
        uint256 supplyBefore = vault.totalSupply();
        _;
        ++calls;
        uint256 hwm = vault.highWaterMark();
        if (supplyBefore != 0 && vault.totalSupply() != 0 && hwm + 1 < lastHwm) ++highWaterMarkFell;
        lastHwm = hwm;
    }

    // ---------------------------------------------------------------- actions

    function deposit(uint256 actorSeed, uint256 amount, uint256 split) external tracked {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, vault.MIN_DEPOSIT(), 50 ether);
        split = bound(split, 7_000, 10_000);
        vm.deal(actor, amount);
        vm.prank(actor);
        try vault.deposit{value: amount}(actor, split) returns (uint256 cohort, uint256 a, uint256 b) {
            expectedRetirement[actor][cohort] += a;
            if (!seenCohort[cohort]) {
                seenCohort[cohort] = true;
                cohorts.push(cohort);
            }
            if (vault.previewRedeem(a + b) > amount + 1) ++depositOverpaid;
        } catch {}
    }

    function flush() external tracked {
        try vault.flush() {
            ++successfulFlushes;
        } catch {}
    }

    /// Jump straight to a cohort's maturity, so claims interleave with everything else mid-sequence.
    function jumpToMaturity(uint256 cohortSeed) external tracked {
        if (cohorts.length == 0) return;
        uint256 maturity = vault.maturityOf(cohorts[cohortSeed % cohorts.length]);
        if (block.timestamp < maturity) vm.warp(maturity);
    }

    function reward(uint256 vSeed, uint256 amount) external tracked {
        amount = bound(amount, 0.001 ether, 30 ether);
        vm.deal(address(this), amount);
        hub.reward{value: amount}(vals[vSeed % 3]);
    }

    function slash(uint256 vSeed, uint256 amount) external tracked {
        try hub.slash(vals[vSeed % 3], bound(amount, 1, 200 ether)) {} catch {}
    }

    function loss(uint256 vSeed, uint256 bps) external tracked {
        address v = vals[vSeed % 3];
        MockStakeCredit credit = MockStakeCredit(payable(hub.getValidatorCreditContract(v)));
        uint256 amount = (credit.totalPooledBNB() * bound(bps, 1, 300)) / 10_000;
        try hub.simulateLoss(v, amount) {} catch {}
    }

    function toggleJail(uint256 vSeed) external tracked {
        address v = vals[vSeed % 3];
        hub.setJailed(v, !hub.jailed(v));
    }

    function warp(uint256 secs) external tracked {
        vm.warp(block.timestamp + bound(secs, 1 hours, 400 days));
    }

    function donate(uint256 amount) external tracked {
        amount = bound(amount, 1, 5 ether);
        vm.deal(address(this), amount);
        (bool ok,) = address(vault).call{value: amount}("");
        require(ok);
    }

    function claim(uint256 actorSeed, uint256 cohortSeed, uint256 bucketSeed, uint256 sharesSeed)
        external
        tracked
    {
        (address actor, uint256 cohort, uint256 id, uint256 balance) =
            _findHolding(actorSeed, cohortSeed, bucketSeed);
        if (balance == 0) return;
        uint256 shares = bound(sharesSeed, 1, balance);
        bool matured = block.timestamp >= vault.maturityOf(cohort);

        vm.prank(actor);
        try vault.requestClaim(id, shares) returns (uint256 claimId) {
            if (!matured) ++earlyClaimSucceeded;
            else ++maturedClaims;
            if (vault.getClaim(claimId).readyAt > block.timestamp) ++unbondedClaims;
            claimIds.push(claimId);
            if (id & 3 == 0) expectedRetirement[actor][cohort] -= shares;
        } catch (bytes memory reason) {
            bytes4 sel = bytes4(reason);
            if (matured && sel != LadderVault.InvalidAmount.selector) {
                ++maturedClaimReverted;
                lastUnexpectedRevert = sel;
            }
        }
    }

    function claimFees(uint256 sharesSeed) external tracked {
        uint256 balance = vault.balanceOf(feeRecipient, 2);
        if (balance == 0) return;
        vm.prank(feeRecipient);
        try vault.requestClaim(2, bound(sharesSeed, 1, balance)) returns (uint256 claimId) {
            claimIds.push(claimId);
        } catch (bytes memory reason) {
            if (bytes4(reason) != LadderVault.InvalidAmount.selector) {
                ++maturedClaimReverted;
                lastUnexpectedRevert = bytes4(reason);
            }
        }
    }

    function withdraw(uint256 indexSeed) external tracked {
        if (claimIds.length == 0) return;
        uint256 claimId = claimIds[indexSeed % claimIds.length];
        LadderVault.Claim memory c = vault.getClaim(claimId);
        if (c.withdrawn || block.timestamp < c.readyAt) return;
        if (!_withdrawWithCollects(claimId)) ++readyWithdrawalFailed;
    }

    function collect() external tracked {
        try vault.collect() {} catch {}
    }

    function tryMoveRetirement(uint256 actorSeed, uint256 cohortSeed) external tracked {
        if (cohorts.length == 0) return;
        address actor = actors[actorSeed % actors.length];
        address other = actors[(actorSeed % actors.length + 1) % actors.length];
        uint256 id = cohorts[cohortSeed % cohorts.length] << 2;
        if (vault.balanceOf(actor, id) == 0) return;

        vm.prank(actor);
        try vault.safeTransferFrom(actor, other, id, 1, "") {
            ++retirementMoved;
        } catch {}
        vm.prank(actor);
        vault.setApprovalForAll(market, true);
        vm.prank(market);
        try vault.safeTransferFrom(actor, other, id, 1, "") {
            ++retirementMoved;
        } catch {}
    }

    function rescue(uint256 fromSeed, uint256 toSeed) external tracked {
        address from;
        for (uint256 i; i < 3; ++i) {
            address candidate = vals[(fromSeed % 3 + i) % 3];
            if (
                MockStakeCredit(payable(hub.getValidatorCreditContract(candidate))).balanceOf(address(vault))
                    != 0
            ) {
                from = candidate;
                break;
            }
        }
        if (from == address(0)) return;
        if (!hub.jailed(from)) hub.setJailed(from, true); // make the rescue path reachable
        address to = vals[toSeed % 3];
        if (to == from) to = vals[(toSeed % 3 + 1) % 3];
        if (hub.jailed(to)) hub.setJailed(to, false);
        MockStakeCredit credit = MockStakeCredit(payable(hub.getValidatorCreditContract(from)));
        uint256 shares = credit.balanceOf(address(vault));
        try vault.redelegate(from, to, shares) {
            ++rescues;
        } catch {}
    }

    function curatorRedelegate(uint256 fromSeed, uint256 toSeed, uint256 bps) external tracked {
        address from = vals[fromSeed % 3];
        address to = vals[toSeed % 3];
        MockStakeCredit credit = MockStakeCredit(payable(hub.getValidatorCreditContract(from)));
        uint256 shares = (credit.balanceOf(address(vault)) * bound(bps, 1, 2_000)) / 10_000;
        if (shares == 0) return;
        vm.prank(curator);
        try vault.redelegate(from, to, shares) {} catch {}
    }

    /// Extra weight on the paths that matter most, since every target function is picked with equal odds.
    function claimAgain(uint256 a, uint256 c, uint256 b, uint256 s) external {
        this.claim(a, c, b, s);
    }

    function withdrawAgain(uint256 i) external {
        this.withdraw(i);
    }

    function _findHolding(uint256 actorSeed, uint256 cohortSeed, uint256 bucketSeed)
        internal
        view
        returns (address actor, uint256 cohort, uint256 id, uint256 balance)
    {
        if (cohorts.length == 0) return (address(0), 0, 0, 0);
        uint256 slots = actors.length * cohorts.length * 2;
        for (uint256 k; k < slots; ++k) {
            // Reduce seeds first: the fuzzer passes values near 2**256, and adding them would overflow.
            uint256 x = (actorSeed % 1e9) + (cohortSeed % 1e9) + (bucketSeed % 1e9) + k;
            actor = actors[x % actors.length];
            cohort = cohorts[(x / actors.length) % cohorts.length];
            id = (cohort << 2) | ((x / (actors.length * cohorts.length)) % 2);
            balance = vault.balanceOf(actor, id);
            if (balance != 0) return (actor, cohort, id, balance);
        }
        return (address(0), 0, 0, 0);
    }

    // ---------------------------------------------------------------- helpers for the invariant suite

    function checkRetirementBalances() external {
        for (uint256 a; a < actors.length; ++a) {
            for (uint256 c; c < cohorts.length; ++c) {
                if (vault.balanceOf(actors[a], cohorts[c] << 2) != expectedRetirement[actors[a]][cohorts[c]])
                {
                    ++retirementBalanceDrift;
                }
            }
        }
    }

    /// @notice Everyone takes everything out. Returns false if any holder cannot get their BNB.
    function drainEverything() external returns (bool) {
        uint256 lastCohort;
        for (uint256 c; c < cohorts.length; ++c) {
            if (cohorts[c] > lastCohort) lastCohort = cohorts[c];
        }
        if (cohorts.length != 0 && block.timestamp < vault.maturityOf(lastCohort)) {
            vm.warp(vault.maturityOf(lastCohort));
        }
        for (uint256 a; a < actors.length; ++a) {
            for (uint256 c; c < cohorts.length; ++c) {
                for (uint256 bucket; bucket < 2; ++bucket) {
                    uint256 id = (cohorts[c] << 2) | bucket;
                    uint256 balance = vault.balanceOf(actors[a], id);
                    if (balance == 0) continue;
                    vm.prank(actors[a]);
                    try vault.requestClaim(id, balance) returns (uint256 claimId) {
                        claimIds.push(claimId);
                    } catch (bytes memory reason) {
                        if (bytes4(reason) != LadderVault.InvalidAmount.selector) return false;
                    }
                }
            }
        }
        uint256 fees = vault.balanceOf(feeRecipient, 2);
        if (fees != 0) {
            vm.prank(feeRecipient);
            try vault.requestClaim(2, fees) returns (uint256 claimId) {
                claimIds.push(claimId);
            } catch (bytes memory reason) {
                if (bytes4(reason) != LadderVault.InvalidAmount.selector) return false;
            }
        }
        vm.warp(block.timestamp + 8 days);
        for (uint256 i; i < claimIds.length; ++i) {
            if (vault.getClaim(claimIds[i]).withdrawn) continue;
            if (!_withdrawWithCollects(claimIds[i])) return false;
        }
        return vault.outstandingClaims() == 0;
    }

    function _withdrawWithCollects(uint256 claimId) internal returns (bool) {
        for (uint256 attempt; attempt < 20; ++attempt) {
            try vault.withdraw(claimId) {
                ++withdrawals;
                return true;
            } catch (bytes memory reason) {
                if (bytes4(reason) != LadderVault.InsufficientLiquidity.selector) {
                    lastUnexpectedRevert = bytes4(reason);
                    return false;
                }
                vault.collect(); // StakeHub claims are batched; keep pulling
            }
        }
        return false;
    }

    receive() external payable {}
}

/// @title Promises that must hold after any sequence of actions
contract LadderVaultInvariants is VaultTestBase {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, hub, market, curator, feeRecipient, [v1, v2, v3]);
        targetContract(address(handler));
        bytes4[] memory skip = new bytes4[](2);
        skip[0] = VaultHandler.checkRetirementBalances.selector;
        skip[1] = VaultHandler.drainEverything.selector;
        excludeSelector(FuzzSelector({addr: address(handler), selectors: skip}));
    }

    /// Claims are always covered by BNB earmarked for them: reserved in the vault, or unbonding.
    function invariant_claimsAlwaysCovered() public view {
        assertGe(vault.reservedLiquidity() + vault.unbonding(), vault.outstandingClaims());
    }

    /// BNB reserved for claims is always physically in the vault.
    function invariant_reservedLiquidityIsHeld() public view {
        assertGe(address(vault).balance, vault.reservedLiquidity());
    }

    /// The vault's unbonding bookkeeping matches StakeHub to the wei.
    function invariant_unbondingMatchesStakeHub() public view {
        uint256 locked;
        address[] memory vs = vault.validators();
        for (uint256 i; i < vs.length; ++i) {
            locked += _credit(vs[i]).lockedBNBs(address(vault), 0);
        }
        assertEq(vault.unbonding(), locked);
    }

    function invariant_nothingRedeemedBeforeMaturity() public view {
        assertEq(handler.earlyClaimSucceeded(), 0);
    }

    function invariant_retirementSharesNeverMove() public {
        handler.checkRetirementBalances();
        assertEq(handler.retirementMoved(), 0);
        assertEq(handler.retirementBalanceDrift(), 0);
    }

    function invariant_highWaterMarkNeverFalls() public view {
        assertEq(handler.highWaterMarkFell(), 0);
    }

    function invariant_depositNeverWorthMoreThanPaid() public view {
        assertEq(handler.depositOverpaid(), 0);
    }

    function invariant_maturedClaimsNeverRevert() public view {
        assertEq(
            handler.maturedClaimReverted(), 0, vm.toString(abi.encodePacked(handler.lastUnexpectedRevert()))
        );
    }

    function invariant_readyWithdrawalsAlwaysPay() public view {
        assertEq(
            handler.readyWithdrawalFailed(), 0, vm.toString(abi.encodePacked(handler.lastUnexpectedRevert()))
        );
    }

    /// After every run: fast-forward past every maturity and have every holder take everything out.
    function afterInvariant() external {
        uint256 midRunClaims = handler.maturedClaims();
        uint256 midRunUnbonded = handler.unbondedClaims();
        uint256 midRunWithdrawals = handler.withdrawals();
        assertTrue(handler.drainEverything(), "someone could not withdraw");
        // Path-coverage notes are a local diagnostic: opt in with COVERAGE_LOG=true.
        if (!vm.envOr("COVERAGE_LOG", false)) return;
        vm.createDir("cache/coverage", true);
        vm.writeLine(
            "cache/coverage/invariants.log",
            string.concat(
                "mid-run matured claims=",
                vm.toString(midRunClaims),
                " unbonded=",
                vm.toString(midRunUnbonded),
                " withdrawals=",
                vm.toString(midRunWithdrawals),
                " flushes=",
                vm.toString(handler.successfulFlushes()),
                " rescues=",
                vm.toString(handler.rescues())
            )
        );
    }
}
