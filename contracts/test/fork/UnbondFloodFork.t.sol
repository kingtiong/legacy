// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {IStakeHub, IStakeCredit} from "../../src/interfaces/IStakeHub.sol";

/// @title The unbond-queue flood (review finding H-1) against BNB Chain's real StakeHub
/// @notice Hundreds of minimum-size claims all unbond from one validator and become claimable together. In v1 every
///         withdrawal first called StakeCredit's unbounded `claimableUnbondRequest` scan, so gas grew about 9,600 per
///         queued request until withdrawals exceeded the block gas limit. v2 reads only the head of the queue and
///         claims at most 50 per call, so every withdrawal stays cheap and every claim is paid.
contract UnbondFloodForkTest is Test {
    IStakeHub internal constant HUB = IStakeHub(0x0000000000000000000000000000000000002002);
    LadderVault internal vault;
    address internal alice = address(uint160(uint256(keccak256("legacy-ladder/fork-test/flood-alice"))));

    function setUp() public {
        vm.createSelectFork(vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.bnbchain.org")));
        address[] memory validators = new address[](1);
        validators[0] = 0xeace91702B20bc6Ee62034eC7f5162D9a94bFbE4; // Ankr
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
        vm.deal(alice, 100 ether);
    }

    function test_floodedQueueKeepsWithdrawalsBounded() public {
        vm.prank(alice);
        (uint256 cohort, uint256 a,) = vault.deposit{value: 20 ether}(alice, 10_000);
        vault.flush();
        vm.warp(vault.maturityOf(cohort));

        uint256 n = 200;
        uint256 slice = (a * 0.0011 ether) / 20 ether;
        vm.startPrank(alice);
        for (uint256 i; i < n; ++i) {
            vault.requestClaim(cohort << 2, slice);
        }
        vm.stopPrank();
        IStakeCredit credit = IStakeCredit(HUB.getValidatorCreditContract(vault.validators()[0]));
        assertEq(credit.pendingUnbondRequest(address(vault)), n, "one real unbond request per claim");

        vm.warp(block.timestamp + HUB.unbondPeriod());

        uint256 worst;
        for (uint256 id; id < n; ++id) {
            uint256 g = gasleft();
            try vault.withdraw(id) {}
            catch (bytes memory reason) {
                assertEq(bytes4(reason), LadderVault.InsufficientLiquidity.selector);
                vault.collect();
                vault.withdraw(id);
            }
            uint256 used = g - gasleft();
            if (used > worst) worst = used;
        }
        emit log_named_uint("worst withdrawal gas with 200 queued requests", worst);
        assertLt(worst, 3_000_000, "bounded: v1 needed ~2.3M for the scan alone at 200");
        assertEq(credit.pendingUnbondRequest(address(vault)), 0, "queue drained");
        assertEq(vault.outstandingClaims(), 0, "every claim paid");
    }
}
