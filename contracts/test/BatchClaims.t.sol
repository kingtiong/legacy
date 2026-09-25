// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LadderVault} from "../src/LadderVault.sol";
import {VaultTestBase} from "./utils/VaultTestBase.sol";

/// @notice Claiming and withdrawing a whole rung in one transaction each. A wallet asks to confirm every transaction
///         separately, so without these a matured rung costs four confirmations: claim, claim, withdraw, withdraw.
contract BatchClaimsTest is VaultTestBase {
    function _matured(address who, uint256 amount) internal returns (uint256 cohort, uint256 a, uint256 b) {
        vm.prank(who);
        (cohort, a, b) = vault.deposit{value: amount}(who, 7_000);
        vm.warp(vault.maturityOf(cohort));
    }

    function _ids(uint256 cohort) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = cohort << 2;
        ids[1] = (cohort << 2) | 1;
    }

    function _pair(uint256 x, uint256 y) internal pure returns (uint256[] memory out) {
        out = new uint256[](2);
        out[0] = x;
        out[1] = y;
    }

    function test_wholeRungInTwoTransactions() public {
        (uint256 cohort, uint256 a, uint256 b) = _matured(alice, 10 ether);
        uint256 before = alice.balance;

        vm.prank(alice);
        uint256[] memory claims = vault.requestClaimMany(_ids(cohort), _pair(a, b));
        assertEq(claims.length, 2);
        assertEq(vault.balanceOf(alice, cohort << 2), 0, "retirement shares burned");
        assertEq(vault.balanceOf(alice, (cohort << 2) | 1), 0, "emergency shares burned");

        vault.withdrawMany(claims);
        assertApproxEqAbs(alice.balance - before, 10 ether, 10, "the whole rung, in one claim and one withdrawal");
        assertTrue(vault.getClaim(claims[0]).withdrawn && vault.getClaim(claims[1]).withdrawn);
    }

    function test_severalRungsAtOnce() public {
        vm.prank(alice);
        (uint256 c1,,) = vault.deposit{value: 3 ether}(alice, 7_000);
        vm.warp(block.timestamp + vault.EPOCH());
        vm.prank(alice);
        (uint256 c2,,) = vault.deposit{value: 2 ether}(alice, 7_000);
        vm.warp(vault.maturityOf(c2));

        uint256[] memory ids = new uint256[](4);
        uint256[] memory shares = new uint256[](4);
        (ids[0], ids[1], ids[2], ids[3]) = (c1 << 2, (c1 << 2) | 1, c2 << 2, (c2 << 2) | 1);
        for (uint256 i; i < 4; ++i) shares[i] = vault.balanceOf(alice, ids[i]);

        uint256 before = alice.balance;
        vm.prank(alice);
        uint256[] memory claims = vault.requestClaimMany(ids, shares);
        assertEq(claims.length, 4);
        vault.withdrawMany(claims);
        assertApproxEqAbs(alice.balance - before, 5 ether, 20, "both rungs paid");
    }

    function test_batchIsTheSameAsOneByOne() public {
        (uint256 cohort, uint256 a, uint256 b) = _matured(alice, 10 ether);
        uint256 snapshot = vm.snapshotState();

        vm.startPrank(alice);
        uint256 one = vault.requestClaim(cohort << 2, a);
        uint256 two = vault.requestClaim((cohort << 2) | 1, b);
        vm.stopPrank();
        (uint256 amountOne, uint256 amountTwo) = (vault.getClaim(one).amount, vault.getClaim(two).amount);
        uint256 singly = vault.outstandingClaims();

        vm.revertToState(snapshot);
        vm.prank(alice);
        uint256[] memory claims = vault.requestClaimMany(_ids(cohort), _pair(a, b));
        assertEq(vault.getClaim(claims[0]).amount, amountOne, "same BNB for the same shares");
        assertEq(vault.getClaim(claims[1]).amount, amountTwo);
        assertEq(vault.outstandingClaims(), singly, "same bookkeeping");
    }

    function test_batchRejectsEmptyAndMismatchedLists() public {
        (uint256 cohort, uint256 a,) = _matured(alice, 10 ether);
        uint256[] memory none = new uint256[](0);
        uint256[] memory one = new uint256[](1);
        one[0] = a;

        vm.startPrank(alice);
        vm.expectRevert(LadderVault.InvalidBatch.selector);
        vault.requestClaimMany(none, none);
        vm.expectRevert(LadderVault.InvalidBatch.selector);
        vault.requestClaimMany(_ids(cohort), one);
        vm.expectRevert(LadderVault.InvalidBatch.selector);
        vault.withdrawMany(none);
        vm.stopPrank();
    }

    /// @notice Every rule of a single claim still applies to each entry: one bad entry fails the whole batch.
    function test_batchKeepsEveryRule() public {
        (uint256 cohort, uint256 a, uint256 b) = _matured(bob, 10 ether);
        vm.prank(bob);
        (uint256 young, uint256 youngShares,) = vault.deposit{value: 1 ether}(bob, 7_000);

        // One entry that is not due yet fails the whole batch, the matured entry included.
        uint256 youngMatures = vault.maturityOf(young); // read before the prank, which the read would spend
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.NotMatured.selector, youngMatures));
        vault.requestClaimMany(_pair(cohort << 2, young << 2), _pair(a, youngShares));
        assertEq(vault.balanceOf(bob, cohort << 2), a, "the matured shares are untouched");

        // The same shares cannot be spent twice inside one batch.
        vm.prank(bob);
        vm.expectRevert();
        vault.requestClaimMany(_pair(cohort << 2, cohort << 2), _pair(a, a));

        vm.prank(bob);
        uint256[] memory claims = vault.requestClaimMany(_ids(cohort), _pair(a, b));
        vault.withdrawMany(claims);
        vm.expectRevert(LadderVault.AlreadyWithdrawn.selector);
        vault.withdrawMany(claims);
    }

    /// @notice Batching pays the owner, never the caller: anyone may push someone else's ready claims out.
    function test_withdrawManyPaysTheOwner() public {
        (uint256 cohort, uint256 a, uint256 b) = _matured(alice, 10 ether);
        vm.prank(alice);
        uint256[] memory claims = vault.requestClaimMany(_ids(cohort), _pair(a, b));

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        vault.withdrawMany(claims);
        assertApproxEqAbs(alice.balance - aliceBefore, 10 ether, 10, "paid to the owner");
        assertEq(bob.balance, bobBefore, "not to the caller");
    }
}
