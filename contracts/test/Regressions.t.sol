// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {VaultTestBase} from "./utils/VaultTestBase.sol";
import {VaultHandler} from "./invariant/LadderVaultInvariants.t.sol";

/// @notice Sequences the invariant fuzzer found that broke a promise, replayed exactly.
contract RegressionsTest is VaultTestBase {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, hub, market, curator, feeRecipient, [v1, v2, v3]);
    }

    /// A claim marked ready could not be paid: a later claim unbonded 1 wei more than it was owed, the old
    /// liquidity rule counted that wei against the first claim's reserve, and flush delegated it away.
    function test_readyClaimLiquidityIsNeverFlushed() public {
        handler.deposit(300, 24, 95);
        handler.donate(604800);
        handler.deposit(120, 1e16, 4);
        handler.claimFees(3600);
        handler.claimFees(8472232819067101313248166117181951531);
        handler.withdraw(28444924424681551050073659491585431466);
        handler.flush();
        handler.claimFees(2e20);
        handler.donate(1033259610551865014171655356963912634421124825867920656471880257065);
        handler.flush();
        handler.withdraw(1000);
        assertEq(handler.readyWithdrawalFailed(), 0);
    }
}
