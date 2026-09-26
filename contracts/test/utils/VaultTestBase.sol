// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {MockStakeHub, MockStakeCredit} from "../mocks/MockStakeHub.sol";

abstract contract VaultTestBase is Test {
    address internal constant STAKE_HUB = 0x0000000000000000000000000000000000002002;

    MockStakeHub internal hub;
    LadderVault internal vault;

    address internal market = makeAddr("market");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal treasury = makeAddr("treasury");
    address internal curator = makeAddr("curator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    address internal v1 = makeAddr("validator1");
    address internal v2 = makeAddr("validator2");
    address internal v3 = makeAddr("validator3");

    uint256 internal constant MIN_DEPOSIT = 0.01 ether;
    uint256 internal constant MAX_DEPOSIT = 1_000 ether;
    uint256 internal constant CAP_INITIAL = 5_000 ether;
    uint256 internal constant CAP_GROWTH = 1_000 ether;
    uint256 internal constant CAP_REMOVED_AT = 24;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.etch(STAKE_HUB, address(new MockStakeHub()).code);
        hub = MockStakeHub(payable(STAKE_HUB));
        vm.deal(address(this), 10_000 ether);
        hub.createValidator{value: 2_000 ether}(v1);
        hub.createValidator{value: 2_000 ether}(v2);
        hub.createValidator{value: 2_000 ether}(v3);

        address[] memory vals = new address[](3);
        vals[0] = v1;
        vals[1] = v2;
        vals[2] = v3;
        vault = new LadderVault(
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

        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 cohort, uint256 a, uint256 b) {
        vm.prank(who);
        return vault.deposit{value: amount}(who, 7_000);
    }

    // Computed locally rather than via vault.shareId(): an external call here would consume a pending vm.prank
    // or vm.expectRevert meant for the call that follows.
    function _idA(uint256 cohort) internal pure returns (uint256) {
        return cohort << 2;
    }

    function _idB(uint256 cohort) internal pure returns (uint256) {
        return (cohort << 2) | 1;
    }

    function _warpToMaturity(uint256 cohort) internal {
        vm.warp(vault.maturityOf(cohort));
    }

    function _credit(address op) internal view returns (MockStakeCredit) {
        return MockStakeCredit(payable(hub.getValidatorCreditContract(op)));
    }

    /// @dev Every holder's votes equal their retirement and emergency shares; the sum equals all non-fee shares; and
    ///      the recorded total agrees one second later.
    function _assertVotesMatchShares(LadderVault v, address[] memory holders, uint256[] memory cohortIds)
        internal
    {
        uint256 sum;
        for (uint256 h; h < holders.length; ++h) {
            uint256 shares;
            for (uint256 c; c < cohortIds.length; ++c) {
                shares += v.balanceOf(holders[h], cohortIds[c] << 2)
                + v.balanceOf(holders[h], (cohortIds[c] << 2) | 1);
            }
            assertEq(v.getVotes(holders[h]), shares, "holder votes == holder shares");
            sum += shares;
        }
        uint256 voting = v.totalSupply() - v.totalSupply(v.FEE_SHARES_ID());
        assertEq(sum, voting, "all voting shares are held by known holders");
        uint256 snapshot = vm.snapshotState();
        vm.warp(block.timestamp + 2);
        assertEq(v.getPastTotalSupply(block.timestamp - 1), voting, "recorded total == voting shares");
        vm.revertToState(snapshot);
    }

    /// @dev Value of all of `who`'s shares in `cohort`, in BNB.
    function _valueOf(address who, uint256 cohort) internal view returns (uint256) {
        return vault.previewRedeem(vault.balanceOf(who, _idA(cohort)) + vault.balanceOf(who, _idB(cohort)));
    }
}
