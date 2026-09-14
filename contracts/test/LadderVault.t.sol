// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {LadderVault} from "../src/LadderVault.sol";
import {VaultTestBase} from "./utils/VaultTestBase.sol";

/// @dev A smart-account owner that holds shares but cannot receive BNB.
contract CannotReceiveBnb is ERC1155Holder {
    function deposit(LadderVault vault) external payable {
        vault.deposit{value: msg.value}(address(this), 7_000);
    }

    function requestClaim(LadderVault vault, uint256 id, uint256 shares) external returns (uint256) {
        return vault.requestClaim(id, shares);
    }

    function withdrawTo(LadderVault vault, uint256 claimId, address to) external {
        vault.withdrawTo(claimId, to);
    }
}

/// @dev A fee recipient that refuses ERC-1155 tokens.
contract RejectsShares {}

contract LadderVaultTest is VaultTestBase {
    // ================================================================ deposits

    function test_deposit_mintsSplitIntoCurrentCohort() public {
        (uint256 cohort, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        assertEq(cohort, 0);
        assertEq(vault.balanceOf(alice, _idA(0)), a);
        assertEq(vault.balanceOf(alice, _idB(0)), b);
        assertEq(a * 3, b * 7, "70/30 split");
        assertApproxEqAbs(vault.totalAssets(), 10 ether, 1);
        assertApproxEqAbs(_valueOf(alice, 0), 10 ether, 2);
    }

    function test_deposit_cohortAdvancesEachEpoch() public {
        vm.warp(vault.GENESIS() + vault.EPOCH());
        (uint256 cohort,,) = _deposit(alice, 1 ether);
        assertEq(cohort, 1);
        assertEq(vault.maturityOf(1), vault.GENESIS() + 122 * vault.EPOCH());
    }

    function test_deposit_everyDepositLockedAtLeastTenYears() public {
        uint256 tenYears = 120 * vault.EPOCH();
        // first and last second of cohort 0
        assertGe(vault.maturityOf(0) - vault.GENESIS(), tenYears);
        assertGe(vault.maturityOf(0) - (vault.GENESIS() + vault.EPOCH() - 1), tenYears);
    }

    function test_deposit_fullRetirementSplitMintsNoEmergencyShares() public {
        vm.prank(alice);
        (, uint256 a, uint256 b) = vault.deposit{value: 1 ether}(alice, 10_000);
        assertGt(a, 0);
        assertEq(b, 0);
        assertEq(vault.balanceOf(alice, _idB(0)), 0);
    }

    function test_deposit_rejectsSofterSplit() public {
        vm.startPrank(alice);
        vm.expectRevert(LadderVault.InvalidSplit.selector);
        vault.deposit{value: 1 ether}(alice, 6_999);
        vm.expectRevert(LadderVault.InvalidSplit.selector);
        vault.deposit{value: 1 ether}(alice, 10_001);
        vm.stopPrank();
    }

    function test_deposit_rejectsOutOfRangeAmountsAndZeroReceiver() public {
        vm.startPrank(alice);
        vm.expectRevert(LadderVault.InvalidAmount.selector);
        vault.deposit{value: MIN_DEPOSIT - 1}(alice, 7_000);
        vm.expectRevert(LadderVault.InvalidAmount.selector);
        vault.deposit{value: MAX_DEPOSIT + 1}(alice, 7_000);
        vm.expectRevert(LadderVault.ZeroAddress.selector);
        vault.deposit{value: 1 ether}(address(0), 7_000);
        vm.stopPrank();
    }

    function test_depositCap_enforcedGrowsAndLifts() public {
        for (uint256 i; i < 5; ++i) {
            _deposit(i % 2 == 0 ? alice : bob, 1_000 ether);
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.DepositCapExceeded.selector, CAP_INITIAL));
        vault.deposit{value: 1 ether}(alice, 7_000);

        vm.warp(vault.GENESIS() + vault.EPOCH());
        assertEq(vault.depositCap(), CAP_INITIAL + CAP_GROWTH);
        _deposit(alice, 1 ether);

        vm.warp(vault.GENESIS() + CAP_REMOVED_AT * vault.EPOCH());
        assertEq(vault.depositCap(), type(uint256).max);
    }

    function test_deposit_laterDepositorGetsFairValueAfterRewards() public {
        _deposit(alice, 10 ether);
        vault.flush();
        hub.reward{value: 50 ether}(v1);

        vm.warp(block.timestamp + 1);
        _deposit(bob, 10 ether);
        assertApproxEqAbs(_valueOf(bob, 0), 10 ether, 1e6, "bob pays the current price, no more, no less");
        assertGt(_valueOf(alice, 0), 10 ether, "alice keeps her share of the rewards");
    }

    // ================================================================ transfer rules

    function test_retirementShares_cannotMove_evenByMarket() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        vm.prank(alice);
        vault.setApprovalForAll(market, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.TransferRestricted.selector, _idA(0)));
        vault.safeTransferFrom(alice, bob, _idA(0), a, "");

        vm.prank(market);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.TransferRestricted.selector, _idA(0)));
        vault.safeTransferFrom(alice, bob, _idA(0), a, "");
    }

    function test_emergencyShares_onlyMarketMovesThem() public {
        (,, uint256 b) = _deposit(alice, 10 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.TransferRestricted.selector, _idB(0)));
        vault.safeTransferFrom(alice, bob, _idB(0), b, "");

        vm.prank(alice);
        vault.setApprovalForAll(market, true);
        vm.prank(market);
        vault.safeTransferFrom(alice, bob, _idB(0), b, "");
        assertEq(vault.balanceOf(bob, _idB(0)), b);
    }

    function test_emergencyShares_frozenOnceMatured() public {
        (,, uint256 b) = _deposit(alice, 10 ether);
        vm.prank(alice);
        vault.setApprovalForAll(market, true);
        _warpToMaturity(0);
        vm.prank(market);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.TransferRestricted.selector, _idB(0)));
        vault.safeTransferFrom(alice, bob, _idB(0), b, "");
    }

    function test_feeShares_moveFreely() public {
        _deposit(alice, 10 ether);
        vault.flush();
        hub.reward{value: 100 ether}(v1);
        vault.accrueFee();
        uint256 fees = vault.balanceOf(feeRecipient, 2);
        assertGt(fees, 0);
        vm.prank(feeRecipient);
        vault.safeTransferFrom(feeRecipient, bob, 2, fees, "");
        assertEq(vault.balanceOf(bob, 2), fees);
    }

    // ================================================================ flush

    function test_flush_delegatesToLeastStakedAndSkipsJailed() public {
        _deposit(alice, 10 ether);
        (address t1,) = vault.flush();
        assertEq(t1, v1);

        _deposit(alice, 5 ether);
        (address t2,) = vault.flush();
        assertEq(t2, v2);

        hub.setJailed(v3, true);
        _deposit(alice, 3 ether);
        (address t3, uint256 amount) = vault.flush();
        assertEq(t3, v2, "v3 is jailed, v2 holds less than v1");
        assertEq(amount, 3 ether);
    }

    function test_flush_revertsBelowStakeHubMinimum() public {
        _deposit(alice, 0.5 ether);
        vm.expectRevert(LadderVault.NothingToFlush.selector);
        vault.flush();
    }

    function test_flush_revertsWhenEveryValidatorIsJailed() public {
        _deposit(alice, 5 ether);
        hub.setJailed(v1, true);
        hub.setJailed(v2, true);
        hub.setJailed(v3, true);
        vm.expectRevert(LadderVault.NoDelegationTarget.selector);
        vault.flush();
        assertApproxEqAbs(vault.totalAssets(), 5 ether, 1, "unflushed BNB still belongs to the pool");
    }

    function test_flush_neverDelegatesBnbOwedToClaims() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        _warpToMaturity(0);
        vm.prank(alice);
        uint256 claimId = vault.requestClaim(_idA(0), a);
        uint256 owed = vault.getClaim(claimId).amount;

        _deposit(bob, 5 ether);
        vault.flush();
        assertGe(address(vault).balance, owed, "claim liquidity stayed in the vault");

        uint256 before = alice.balance;
        vault.withdraw(claimId);
        assertEq(alice.balance - before, owed);
    }

    // ================================================================ claims

    function test_claim_revertsOneSecondBeforeMaturity() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        uint256 maturity = vault.maturityOf(0);
        vm.warp(maturity - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.NotMatured.selector, maturity));
        vault.requestClaim(_idA(0), a);
    }

    function test_claim_instantWhenIdleBnbCovers() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        _warpToMaturity(0);
        vm.prank(alice);
        uint256 claimId = vault.requestClaim(_idA(0), a);
        LadderVault.Claim memory c = vault.getClaim(claimId);
        assertEq(c.readyAt, block.timestamp);
        assertApproxEqAbs(c.amount, 7 ether, 2);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(claimId);
        assertEq(alice.balance - before, c.amount);
        assertEq(vault.outstandingClaims(), 0);
    }

    function test_claim_unbondsStakeAndPaysAfterUnbondPeriod() public {
        (, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        vault.flush();
        _warpToMaturity(0);

        vm.prank(alice);
        uint256 claimA = vault.requestClaim(_idA(0), a);
        vm.prank(alice);
        uint256 claimB = vault.requestClaim(_idB(0), b);
        LadderVault.Claim memory ca = vault.getClaim(claimA);
        assertEq(ca.readyAt, block.timestamp + 7 days);
        assertGe(vault.unbonding(), vault.outstandingClaims(), "unbond covers what is owed");

        vm.expectRevert(abi.encodeWithSelector(LadderVault.ClaimNotReady.selector, ca.readyAt));
        vault.withdraw(claimA);

        vm.warp(ca.readyAt);
        uint256 before = alice.balance;
        vault.withdraw(claimA);
        vault.withdraw(claimB);
        assertApproxEqAbs(
            alice.balance - before, 10 ether, 10, "alice gets her deposit back through the 5000-gas payout"
        );
        assertEq(vault.outstandingClaims(), 0);
    }

    function test_claim_worksFromValidatorJailedAfterStaking() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        vault.flush();
        hub.setJailed(v1, true);
        _warpToMaturity(0);
        vm.prank(alice);
        uint256 claimId = vault.requestClaim(_idA(0), a);
        vm.warp(block.timestamp + 7 days);
        uint256 before = alice.balance;
        vault.withdraw(claimId);
        assertApproxEqAbs(alice.balance - before, 7 ether, 10);
    }

    function test_claim_includesRewardsNetOfFee() public {
        (, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        vault.flush();
        uint256 assetsBefore = vault.totalAssets();
        hub.reward{value: 100 ether}(v1);
        uint256 gain = vault.totalAssets() - assetsBefore;

        _warpToMaturity(0);
        vm.startPrank(alice);
        uint256 c1 = vault.requestClaim(_idA(0), a);
        uint256 c2 = vault.requestClaim(_idB(0), b);
        vm.stopPrank();
        uint256 total = vault.getClaim(c1).amount + vault.getClaim(c2).amount;
        assertApproxEqAbs(total, 10 ether + (gain * 7) / 10, 1e4);
    }

    function test_withdraw_cannotRunTwice() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        _warpToMaturity(0);
        vm.prank(alice);
        uint256 claimId = vault.requestClaim(_idA(0), a);
        vault.withdraw(claimId);
        vm.expectRevert(LadderVault.AlreadyWithdrawn.selector);
        vault.withdraw(claimId);
    }

    function test_withdraw_anyoneCanTriggerButOnlyOwnerIsPaid() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        _warpToMaturity(0);
        vm.prank(alice);
        uint256 claimId = vault.requestClaim(_idA(0), a);
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        vault.withdraw(claimId);
        assertGt(alice.balance, aliceBefore);
        assertEq(bob.balance, bobBefore);
    }

    function test_withdrawTo_rescuesOwnerThatCannotReceiveBnb() public {
        CannotReceiveBnb owner = new CannotReceiveBnb();
        vm.deal(address(owner), 0);
        owner.deposit{value: 10 ether}(vault);
        _warpToMaturity(0);
        uint256 shares = vault.balanceOf(address(owner), _idA(0));
        uint256 claimId = owner.requestClaim(vault, _idA(0), shares);

        vm.expectRevert(LadderVault.WithdrawFailed.selector);
        vault.withdraw(claimId);

        vm.prank(bob);
        vm.expectRevert(LadderVault.NotClaimOwner.selector);
        vault.withdrawTo(claimId, bob);

        uint256 before = bob.balance;
        owner.withdrawTo(vault, claimId, bob);
        assertApproxEqAbs(bob.balance - before, 7 ether, 2);
    }

    function test_claim_manyUsersAllPaidInFull() public {
        address[5] memory users =
            [makeAddr("u1"), makeAddr("u2"), makeAddr("u3"), makeAddr("u4"), makeAddr("u5")];
        for (uint256 i; i < users.length; ++i) {
            vm.deal(users[i], 100 ether);
            _deposit(users[i], (i + 1) * 3 ether);
        }
        vault.flush();
        hub.reward{value: 200 ether}(v1);
        _warpToMaturity(0);

        uint256[] memory ids = new uint256[](users.length * 2);
        for (uint256 i; i < users.length; ++i) {
            vm.startPrank(users[i]);
            ids[2 * i] = vault.requestClaim(_idA(0), vault.balanceOf(users[i], _idA(0)));
            ids[2 * i + 1] = vault.requestClaim(_idB(0), vault.balanceOf(users[i], _idB(0)));
            vm.stopPrank();
        }
        vm.warp(block.timestamp + 7 days);
        for (uint256 i; i < users.length; ++i) {
            uint256 before = users[i].balance;
            vault.withdraw(ids[2 * i]);
            vault.withdraw(ids[2 * i + 1]);
            assertGe(users[i].balance - before, (i + 1) * 3 ether, "everyone gets at least their deposit");
        }
        assertEq(vault.outstandingClaims(), 0);
    }

    // ================================================================ fees

    function test_fee_isThirtyPercentOfRewards() public {
        _deposit(alice, 10 ether);
        vault.flush();
        uint256 before = vault.totalAssets();
        hub.reward{value: 100 ether}(v1);
        uint256 gain = vault.totalAssets() - before;

        vault.accrueFee();
        uint256 feeValue = vault.previewRedeem(vault.balanceOf(feeRecipient, 2));
        assertApproxEqRel(feeValue, (gain * 3) / 10, 1e14, "fee = 30% of gain");
        assertApproxEqAbs(_valueOf(alice, 0), 10 ether + (gain * 7) / 10, 1e6, "alice keeps 70%");
    }

    function test_fee_notChargedOnDeposits() public {
        _deposit(alice, 10 ether);
        vault.accrueFee();
        _deposit(bob, 20 ether);
        vault.accrueFee();
        assertEq(vault.balanceOf(feeRecipient, 2), 0);
    }

    function test_fee_highWaterMark_noFeeWhileRecoveringLosses() public {
        _deposit(alice, 10 ether);
        vault.flush();
        hub.reward{value: 100 ether}(v1);
        vault.accrueFee();
        uint256 feesAfterFirstGain = vault.balanceOf(feeRecipient, 2);
        uint256 peak = vault.sharePrice();

        hub.simulateLoss(v1, 500 ether);
        vault.accrueFee();
        assertLt(vault.sharePrice(), peak);

        hub.reward{value: 400 ether}(v1); // recovers most, but not all, of the loss
        vault.accrueFee();
        assertLe(vault.sharePrice(), peak, "still below the previous peak");
        assertEq(vault.balanceOf(feeRecipient, 2), feesAfterFirstGain, "no fee while below the peak");

        hub.reward{value: 500 ether}(v1);
        vault.accrueFee();
        assertGt(vault.balanceOf(feeRecipient, 2), feesAfterFirstGain, "fees resume above the peak");
    }

    function test_fee_recipientThatRejectsSharesCannotBlockTheVault() public {
        address rejector = address(new RejectsShares());
        vm.prank(feeRecipient);
        vault.transferFeeRecipient(rejector);
        vm.prank(rejector);
        vault.acceptFeeRecipient();

        (, uint256 a,) = _deposit(alice, 10 ether);
        vault.flush();
        hub.reward{value: 100 ether}(v1);
        _deposit(bob, 1 ether);
        assertGt(vault.balanceOf(rejector, 2), 0, "fee shares credited without a callback");

        _warpToMaturity(0);
        vm.prank(alice);
        vault.requestClaim(_idA(0), a);
    }

    function test_feeShares_redeemableWithoutWaiting() public {
        _deposit(alice, 10 ether);
        vault.flush();
        hub.reward{value: 100 ether}(v1);
        vault.accrueFee();
        uint256 fees = vault.balanceOf(feeRecipient, 2);
        vm.prank(feeRecipient);
        uint256 claimId = vault.requestClaim(2, fees);
        assertGt(vault.getClaim(claimId).amount, 0);
    }

    // ================================================================ curator

    function test_addValidator_rules() public {
        address v4 = makeAddr("validator4");
        vm.expectRevert(LadderVault.NotCurator.selector);
        vault.addValidator(v4);

        vm.startPrank(curator);
        vm.expectRevert(LadderVault.UnknownValidator.selector);
        vault.addValidator(v4);
        vm.expectRevert(LadderVault.ValidatorAlreadyListed.selector);
        vault.addValidator(v1);
        vm.stopPrank();

        hub.createValidator{value: 2_000 ether}(v4);
        hub.setJailed(v4, true);
        vm.prank(curator);
        vm.expectRevert(LadderVault.ValidatorJailed.selector);
        vault.addValidator(v4);

        hub.setJailed(v4, false);
        vm.prank(curator);
        vault.addValidator(v4);
        assertTrue(vault.isValidator(v4));
    }

    function test_addValidator_capsListLength() public {
        vm.deal(address(this), 100_000 ether);
        for (uint256 i = 4; i <= 16; ++i) {
            address v = address(uint160(0x1000 + i));
            hub.createValidator{value: 1 ether}(v);
            vm.prank(curator);
            vault.addValidator(v);
        }
        address extra = address(uint160(0x2000));
        hub.createValidator{value: 1 ether}(extra);
        vm.prank(curator);
        vm.expectRevert(LadderVault.ValidatorLimit.selector);
        vault.addValidator(extra);
    }

    function test_removeValidator_onlyWhenVaultHoldsNothingThere() public {
        _deposit(alice, 10 ether);
        vault.flush(); // v1
        vm.startPrank(curator);
        vm.expectRevert(LadderVault.ValidatorStillHoldsStake.selector);
        vault.removeValidator(v1);
        vault.removeValidator(v3);
        vm.stopPrank();
        assertFalse(vault.isValidator(v3));
        assertEq(vault.validators().length, 2);
    }

    function test_redelegate_curatorIsRateLimited() public {
        _deposit(alice, 1_000 ether);
        vault.flush(); // all on v1
        uint256 shares50 = _credit(v1).getSharesByPooledBNB(50 ether);
        uint256 shares60 = _credit(v1).getSharesByPooledBNB(60 ether);

        vm.startPrank(curator);
        vault.redelegate(v1, v2, shares50);
        vm.expectPartialRevert(LadderVault.RedelegateLimitExceeded.selector);
        vault.redelegate(v1, v2, shares60);
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days);
        vm.prank(curator);
        vault.redelegate(v1, v2, shares60);
    }

    function test_redelegate_strangerCannotMoveHealthyStake() public {
        _deposit(alice, 10 ether);
        vault.flush();
        uint256 shares = _credit(v1).balanceOf(address(vault));
        vm.prank(bob);
        vm.expectRevert(LadderVault.NotCurator.selector);
        vault.redelegate(v1, v2, shares);
    }

    function test_redelegate_anyoneRescuesStakeFromJailedValidator() public {
        _deposit(alice, 1_000 ether);
        vault.flush();
        hub.setJailed(v1, true);
        uint256 shares = _credit(v1).balanceOf(address(vault));
        uint256 assetsBefore = vault.totalAssets();

        vm.prank(bob);
        vault.redelegate(v1, v2, shares);
        assertEq(_credit(v1).balanceOf(address(vault)), 0);
        assertApproxEqRel(vault.totalAssets(), assetsBefore, 1e15, "only StakeHub's 0.002% fee is lost");
    }

    function test_redelegate_cannotTargetJailedValidator() public {
        _deposit(alice, 10 ether);
        vault.flush();
        hub.setJailed(v2, true);
        uint256 shares = _credit(v1).balanceOf(address(vault));
        vm.prank(curator);
        vm.expectRevert(LadderVault.ValidatorJailed.selector);
        vault.redelegate(v1, v2, shares);
    }

    function test_roles_transferInTwoSteps() public {
        vm.prank(curator);
        vault.transferCurator(bob);
        assertEq(vault.curator(), curator);
        vm.prank(alice);
        vm.expectRevert(LadderVault.NotPendingRole.selector);
        vault.acceptCurator();
        vm.prank(bob);
        vault.acceptCurator();
        assertEq(vault.curator(), bob);

        vm.prank(alice);
        vm.expectRevert(LadderVault.NotFeeRecipient.selector);
        vault.transferFeeRecipient(alice);
    }

    // ================================================================ StakeHub edge cases

    function test_receive_fitsStakeHubGasStipend() public {
        (bool ok,) = address(vault).call{gas: 5000, value: 1 ether}("");
        assertTrue(ok, "StakeHub pays unbonds with 5000 gas");
    }

    function test_accounting_survivesListedValidatorWithNoShares() public {
        address empty = makeAddr("emptyValidator");
        hub.createValidator(empty); // no self-delegation: StakeCredit's conversions revert
        vm.prank(curator);
        vault.addValidator(empty);

        (, uint256 a,) = _deposit(alice, 10 ether);
        vault.flush();
        assertApproxEqAbs(vault.totalAssets(), 10 ether, 10);
        _warpToMaturity(0);
        vm.prank(alice);
        vault.requestClaim(_idA(0), a);
    }

    function test_slashingDoesNotReduceDelegatorValue() public {
        _deposit(alice, 10 ether);
        vault.flush();
        uint256 before = vault.totalAssets();
        hub.slash(v1, 100 ether);
        assertApproxEqAbs(vault.totalAssets(), before, 10, "BNB Chain slashes the validator's own stake");
    }

    function test_eip7702Account_canDepositWithoutReceiverHook() public {
        address delegated = makeAddr("delegated7702");
        vm.etch(delegated, abi.encodePacked(hex"ef0100", address(new RejectsShares())));
        vm.deal(delegated, 10 ether);
        vm.prank(delegated);
        (, uint256 a,) = vault.deposit{value: 1 ether}(delegated, 7_000);
        assertEq(vault.balanceOf(delegated, _idA(0)), a);
    }

    function test_plainContractWithoutHook_stillRejectedAsErc1155Requires() public {
        address plain = address(new RejectsShares());
        vm.prank(alice);
        vm.expectRevert();
        vault.deposit{value: 1 ether}(plain, 7_000);
    }

    function test_donation_raisesEveryonesValue() public {
        _deposit(alice, 10 ether);
        (bool ok,) = address(vault).call{value: 5 ether}("");
        assertTrue(ok);
        assertGt(_valueOf(alice, 0), 10 ether);
    }
}

contract ShareIdTest is VaultTestBase {
    /// @dev Keeps the tests' local id helpers honest against the vault's own encoding.
    function test_localIdHelpersMatchVault() public view {
        for (uint256 c; c < 300; c += 37) {
            assertEq(_idA(c), vault.shareId(c, 0));
            assertEq(_idB(c), vault.shareId(c, 1));
        }
    }
}
