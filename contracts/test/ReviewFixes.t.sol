// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LadderVault} from "../src/LadderVault.sol";
import {IStakeHub} from "../src/interfaces/IStakeHub.sol";
import {VaultTestBase} from "./utils/VaultTestBase.sol";

/// @notice One test per issue found by the 2026-09-16 pre-audit review, proving the v2 fix.
contract ReviewFixesTest is VaultTestBase {
    // ================================================================ H-1: flooding the unbond queue

    /// Hundreds of small claims, all claimable at once, used to push every withdrawal past the block gas limit.
    /// Now each call does bounded work, and every claim still gets paid.
    function test_H1_floodedUnbondQueueCannotFreezeWithdrawals() public {
        (uint256 cohort, uint256 a,) = _deposit(alice, 500 ether);
        vault.flush();
        _warpToMaturity(cohort);

        // Many claims at the minimum size, each needing its own unbond.
        uint256 slice = (a * 0.0011 ether) / 350 ether; // just over MIN_CLAIM each
        uint256 n = 300;
        vm.startPrank(alice);
        for (uint256 i; i < n; ++i) {
            vault.requestClaim(_idA(cohort), slice);
        }
        vm.stopPrank();
        uint256 pending;
        address[] memory vs = vault.validators();
        for (uint256 i; i < vs.length; ++i) {
            pending += _credit(vs[i]).pendingUnbondRequest(address(vault));
        }
        assertGe(pending, n, "one unbond request per claim");

        vm.warp(block.timestamp + hub.unbondPeriod());

        // Every withdrawal stays bounded: at most 50 requests per validator are claimed per call.
        uint256 worstGas;
        uint256 paid;
        for (uint256 id; id < vault.claimCount(); ++id) {
            uint256 g = gasleft();
            try vault.withdraw(id) {
                paid++;
            } catch (bytes memory reason) {
                assertEq(
                    bytes4(reason), LadderVault.InsufficientLiquidity.selector, "only waits for liquidity"
                );
                vault.collect(); // anyone can pull the next batch
                vault.withdraw(id);
                paid++;
            }
            uint256 used = g - gasleft();
            if (used > worstGas) worstGas = used;
        }
        assertEq(paid, n, "every claim paid");
        assertLt(worstGas, 15_000_000, "no call anywhere near the block gas limit");
    }

    /// The scan that could be flooded is never called.
    function test_H1_collectNeverScansTheWholeQueue() public {
        (uint256 cohort, uint256 a,) = _deposit(alice, 10 ether);
        vault.flush();
        _warpToMaturity(cohort);
        vm.prank(alice);
        uint256 claimId = vault.requestClaim(_idA(cohort), a);
        vm.warp(block.timestamp + hub.unbondPeriod());
        address[] memory vs = vault.validators();
        for (uint256 i; i < vs.length; ++i) {
            vm.mockCallRevert(
                address(_credit(vs[i])),
                abi.encodeWithSignature("claimableUnbondRequest(address)", address(vault)),
                "unbounded scan used"
            );
        }
        vault.withdraw(claimId);
    }

    // ================================================================ M-1: StakeHub pause

    /// BNB already reserved in the vault is paid even while StakeHub refuses to pay out unbonds.
    function test_M1_stakeHubPauseDoesNotBlockReservedBnb() public {
        (uint256 c1, uint256 a1,) = _deposit(alice, 10 ether);
        vault.flush();
        _warpToMaturity(c1);
        vm.prank(alice);
        uint256 unbonded = vault.requestClaim(_idA(c1), a1); // needs StakeHub
        vm.warp(block.timestamp + hub.unbondPeriod());

        // A fresh deposit leaves idle BNB, so bob's claim is instant and fully reserved.
        (uint256 c2, uint256 a2,) = _deposit(bob, 5 ether);
        _warpToMaturity(c2);
        vm.prank(bob);
        uint256 instant = vault.requestClaim(_idA(c2), a2);

        vm.mockCallRevert(STAKE_HUB, abi.encodeWithSelector(IStakeHub.claim.selector), "paused");
        uint256 before = bob.balance;
        vault.withdraw(instant);
        assertGt(bob.balance, before, "reserved BNB paid during the pause");

        vm.expectRevert(LadderVault.InsufficientLiquidity.selector);
        vault.withdraw(unbonded); // this one genuinely needs StakeHub; it waits, it is not lost
        vm.clearMockedCalls();
        vault.withdraw(unbonded);
    }

    // ================================================================ spam protection

    function test_minClaim_smallPartialClaimRefused_wholeBalanceAllowed() public {
        (uint256 cohort, uint256 a,) = _deposit(alice, 1 ether);
        _warpToMaturity(cohort);
        uint256 tiny = a / 10_000; // about 0.00007 BNB
        vm.prank(alice);
        vm.expectRevert(LadderVault.InvalidAmount.selector);
        vault.requestClaim(_idA(cohort), tiny);

        // A remainder below the minimum can always be redeemed in full.
        (uint256 c2,, uint256 bobB) = _deposit(bob, 0.01 ether); // 0.003 BNB emergency
        _warpToMaturity(c2);
        vm.prank(bob);
        vault.requestClaim(_idB(c2), (bobB * 5) / 6); // 0.0025 BNB, above the minimum
        uint256 rest = vault.balanceOf(bob, _idB(c2));
        assertLt(vault.previewRedeem(rest), vault.MIN_CLAIM());
        vm.prank(bob);
        vault.requestClaim(_idB(c2), rest);
    }

    // ================================================================ L-1: seed and donations

    function test_L1_seededVaultIgnoresPreDepositDonation() public {
        LadderVault seeded = _seededVault(0.001 ether);
        assertEq(seeded.balanceOf(seeded.DEAD(), 2), 0.001 ether * 1e3, "seed shares held by nobody");
        assertEq(seeded.getVotes(seeded.DEAD()), 0, "seed carries no votes");

        // A 10 BNB gift before anyone deposits no longer breaks small deposits.
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(seeded).call{value: 10 ether}("");
        assertTrue(ok);
        vm.prank(alice);
        (, uint256 a, uint256 b) = seeded.deposit{value: 0.01 ether}(alice, 7_000);
        assertGt(a + b, 0);
        assertApproxEqRel(seeded.previewRedeem(a + b), 0.01 ether, 0.01e18, "deposit keeps its value");
    }

    function test_L1_highWaterMarkWaitsUntilAFeeCanBeMinted() public {
        _deposit(alice, 10 ether);
        vault.flush();
        uint256 mark = vault.highWaterMark();
        vm.deal(address(vault), address(vault).balance + 1); // a 1 wei gain: too small for a fee share
        vault.accrueFee();
        assertEq(vault.balanceOf(feeRecipient, 2), 0);
        assertEq(vault.highWaterMark(), mark, "mark kept, so the gain is charged later");
    }

    // ================================================================ L-2: rescue dust

    function test_L2_rescueMovesEverythingSoRemovalIsNeverBlocked() public {
        _deposit(alice, 30 ether);
        vault.flush();
        address[] memory vs = vault.validators();
        address from;
        for (uint256 i; i < vs.length; ++i) {
            if (_credit(vs[i]).balanceOf(address(vault)) != 0) from = vs[i];
        }
        address to = from == v1 ? v2 : v1;
        hub.setJailed(from, true);
        uint256 held = _credit(from).balanceOf(address(vault));

        vm.prank(bob); // anyone, asking to leave 1 share behind
        vault.redelegate(from, to, held - 1);
        assertEq(_credit(from).balanceOf(address(vault)), 0, "rescue took everything");

        vm.prank(curator);
        vault.removeValidator(from);
        assertFalse(vault.isValidator(from));
    }

    // ================================================================ L-4: same-second votes

    function test_L4_depositInTheSameSecondDoesNotCount() public {
        (, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        uint256 t = block.timestamp;
        vm.warp(t + 1);
        assertEq(vault.getPastVotes(alice, t), 0, "not counted in the second it landed");
        vm.warp(t + 2);
        assertEq(vault.getPastVotes(alice, t + 1), a + b, "counted from the next second");
    }

    // ================================================================ helpers

    function _seededVault(uint256 seed) internal returns (LadderVault v) {
        address[] memory vals = new address[](3);
        vals[0] = v1;
        vals[1] = v2;
        vals[2] = v3;
        vm.deal(address(this), seed);
        v = new LadderVault{value: seed}(
            LadderVault.Config({
                market: market,
                feeRecipient: feeRecipient,
                curator: curator,
                validators: vals,
                minDeposit: MIN_DEPOSIT,
                maxDeposit: MAX_DEPOSIT,
                capInitial: CAP_INITIAL,
                capGrowthPerEpoch: CAP_GROWTH,
                capRemovedAtEpoch: CAP_REMOVED_AT,
                epoch: 2_629_746,
                lockEpochs: 120
            })
        );
    }
}
