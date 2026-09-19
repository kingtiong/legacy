// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LadderVault} from "../src/LadderVault.sol";
import {VaultTestBase} from "./utils/VaultTestBase.sol";

/// @notice The ten-hour test edition (script/Deploy.s.sol:DeployTest): the same vault with 5-minute cohorts, so 120
///         of them take 10 hours. Proves the full deposit, lock, claim and withdraw path at that speed.
contract ShortLockTest is VaultTestBase {
    LadderVault internal fast;

    function setUp() public override {
        super.setUp();
        address[] memory vals = new address[](1);
        vals[0] = v1;
        fast = new LadderVault(
            LadderVault.Config({
                market: market,
                feeRecipient: feeRecipient,
                curator: curator,
                validators: vals,
                minDeposit: 0.001 ether,
                maxDeposit: 0.05 ether,
                capInitial: 1 ether,
                capGrowthPerEpoch: 0,
                capRemovedAtEpoch: type(uint256).max,
                epoch: 5 minutes,
                lockEpochs: 120
            })
        );
    }

    function test_tenHourLifecycle() public {
        vm.warp(block.timestamp + 7 minutes); // mid-way through cohort 1
        vm.prank(alice);
        (uint256 cohort, uint256 a, uint256 b) = fast.deposit{value: 0.01 ether}(alice, 7_000);
        assertEq(cohort, 1);

        uint256 unlock = fast.maturityOf(cohort);
        assertEq(unlock, fast.GENESIS() + (1 + 1 + 120) * 5 minutes, "unlocks at the end of cohort 121");
        assertGe(unlock - block.timestamp, 10 hours, "never less than ten hours");
        assertLe(unlock - block.timestamp, 10 hours + 5 minutes, "at most one cohort more");

        vm.warp(unlock - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LadderVault.NotMatured.selector, unlock));
        fast.requestClaim(cohort << 2, a);

        vm.warp(unlock);
        uint256 before = alice.balance;
        vm.startPrank(alice);
        uint256 c1 = fast.requestClaim(cohort << 2, a);
        uint256 c2 = fast.requestClaim((cohort << 2) | 1, b);
        vm.stopPrank();
        assertEq(fast.getClaim(c1).readyAt, block.timestamp, "unstaked BNB: paid straight away");
        fast.withdraw(c1);
        fast.withdraw(c2);
        assertApproxEqAbs(alice.balance - before, 0.01 ether, 10, "the whole deposit back");
    }

    function test_rejectsZeroLockSettings() public {
        address[] memory vals = new address[](0);
        LadderVault.Config memory cfg = LadderVault.Config({
            market: market,
            feeRecipient: feeRecipient,
            curator: curator,
            validators: vals,
            minDeposit: 1,
            maxDeposit: 1,
            capInitial: 1,
            capGrowthPerEpoch: 0,
            capRemovedAtEpoch: 0,
            epoch: 0,
            lockEpochs: 120
        });
        vm.expectRevert(LadderVault.InvalidAmount.selector);
        new LadderVault(cfg);
        cfg.epoch = 1;
        cfg.lockEpochs = 0;
        vm.expectRevert(LadderVault.InvalidAmount.selector);
        new LadderVault(cfg);
    }
}
