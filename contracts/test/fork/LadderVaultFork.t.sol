// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {IStakeHub, IStakeCredit} from "../../src/interfaces/IStakeHub.sol";

/// @title The full ten-year lifecycle against BNB Chain's real StakeHub
/// @notice Deposit, delegate to real validators, wait ten years, claim, unbond, and withdraw through StakeHub's
///         real 5,000 gas payout. Run with: forge test --match-path test/fork/*
contract LadderVaultForkTest is Test {
    IStakeHub internal constant HUB = IStakeHub(0x0000000000000000000000000000000000002002);

    LadderVault internal vault;
    address[] internal validators;
    // Fresh addresses: common labels like "alice" have public keys, and on mainnet some carry EIP-7702 code.
    address internal alice = address(uint160(uint256(keccak256("legacy-ladder/fork-test/alice"))));
    address internal bob = address(uint160(uint256(keccak256("legacy-ladder/fork-test/bob"))));

    function setUp() public {
        vm.createSelectFork(vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.bnbchain.org")));
        (address[] memory ops,,) = HUB.getValidators(0, 100);
        for (uint256 i; i < ops.length && validators.length < 3; ++i) {
            (, bool jailed,) = HUB.getValidatorBasicInfo(ops[i]);
            if (!jailed) validators.push(ops[i]);
        }
        vault = new LadderVault(
            LadderVault.Config({
                market: makeAddr("market"),
                feeRecipient: makeAddr("feeRecipient"),
                curator: makeAddr("curator"),
                validators: validators,
                minDeposit: 0.01 ether,
                maxDeposit: 1_000 ether,
                capInitial: 10_000 ether,
                capGrowthPerEpoch: 0,
                capRemovedAtEpoch: 24,
                epoch: 2_629_746,
                lockEpochs: 120
            })
        );
        vm.etch(alice, "");
        vm.etch(bob, "");
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function test_tenYearLifecycleOnRealStakeHub() public {
        vm.prank(alice);
        (uint256 cohort, uint256 a, uint256 b) = vault.deposit{value: 5 ether}(alice, 7_000);
        vm.prank(bob);
        vault.deposit{value: 3 ether}(bob, 10_000);

        (address target, uint256 delegated) = vault.flush();
        assertEq(delegated, 8 ether);
        assertGt(IStakeCredit(HUB.getValidatorCreditContract(target)).balanceOf(address(vault)), 0);
        assertApproxEqAbs(vault.totalAssets(), 8 ether, 10, "real StakeCredit rounding is tiny");

        // ten years later
        vm.warp(vault.maturityOf(cohort));
        vm.startPrank(alice);
        uint256 claimA = vault.requestClaim(cohort << 2, a);
        uint256 claimB = vault.requestClaim((cohort << 2) | 1, b);
        vm.stopPrank();

        LadderVault.Claim memory c = vault.getClaim(claimA);
        assertEq(c.readyAt, block.timestamp + HUB.unbondPeriod(), "real unbonding needed");
        assertGe(vault.unbonding() + vault.reservedLiquidity(), vault.outstandingClaims());

        vm.expectRevert(abi.encodeWithSelector(LadderVault.ClaimNotReady.selector, c.readyAt));
        vault.withdraw(claimA);

        vm.warp(c.readyAt);
        uint256 before = alice.balance;
        vault.withdraw(claimA); // collects from the real StakeHub through its 5,000 gas payout
        vault.withdraw(claimB);
        assertApproxEqAbs(alice.balance - before, 5 ether, 100, "alice gets her 5 BNB back");

        uint256 bobShares = vault.balanceOf(bob, cohort << 2);
        vm.prank(bob);
        uint256 claimBob = vault.requestClaim(cohort << 2, bobShares);
        vm.warp(block.timestamp + HUB.unbondPeriod());
        before = bob.balance;
        vault.withdraw(claimBob);
        assertApproxEqAbs(bob.balance - before, 3 ether, 100, "bob gets his 3 BNB back");
        assertEq(vault.outstandingClaims(), 0);
    }

    function test_vaultReceiveFitsRealStipend() public view {
        assertEq(HUB.transferGasLimit(), 5000);
    }
}
