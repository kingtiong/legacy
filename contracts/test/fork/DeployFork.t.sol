// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {CohortMarket} from "../../src/CohortMarket.sol";
import {LadderGovernor} from "../../src/LadderGovernor.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title The launch stack on a BNB Chain mainnet fork, then one full DAO vote
/// @notice Deploys timelock, vault, market and governor in the deploy script's order with its launch settings (launch
///         validators, real USDT and USDC), and takes a proposal from creation to execution with votes read from real
///         deposits staked with the real StakeHub. The script itself is exercised with `forge script` against a fork,
///         because inside a test its contracts would be created from the script contract rather than the deployer.
///         Run with: forge test --match-path test/fork/*
contract DeployForkTest is Test {
    TimelockController internal timelock;
    LadderVault internal vault;
    CohortMarket internal market;
    LadderGovernor internal governor;

    address internal alice = address(uint160(uint256(keccak256("legacy-ladder/fork-test/alice"))));
    address internal bob = address(uint160(uint256(keccak256("legacy-ladder/fork-test/bob"))));
    address internal grantee = address(uint160(uint256(keccak256("legacy-ladder/fork-test/grantee"))));

    function setUp() public {
        vm.createSelectFork(vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.bnbchain.org")));

        uint256 nonce = vm.getNonce(address(this));
        address predictedMarket = vm.computeCreateAddress(address(this), nonce + 2);
        address predictedGovernor = vm.computeCreateAddress(address(this), nonce + 3);
        address[] memory proposers = new address[](1);
        proposers[0] = predictedGovernor;
        address[] memory executors = new address[](1);
        timelock = new TimelockController(2 days, proposers, executors, address(0));

        address[] memory launchValidators = new address[](4);
        launchValidators[0] = 0xeace91702B20bc6Ee62034eC7f5162D9a94bFbE4; // Ankr
        launchValidators[1] = 0x477cB5d87144b2a6d93f72e32f5E01a459260D68; // Figment
        launchValidators[2] = 0x7d0F8A6D1C8fbF929Dcf4847A31E30d14923Fa31; // NodeReal
        launchValidators[3] = 0xaACc290a1A4c89F5D7bc29913122F5982916de48; // The48Club
        vault = new LadderVault(
            LadderVault.Config({
                market: predictedMarket,
                feeRecipient: address(timelock),
                curator: address(timelock),
                validators: launchValidators,
                minDeposit: 0.01 ether,
                maxDeposit: 10 ether,
                capInitial: 100 ether,
                capGrowthPerEpoch: 50 ether,
                capRemovedAtEpoch: 36,
                epoch: 2_629_746,
                lockEpochs: 120
            })
        );
        market = new CohortMarket(
            vault,
            IERC20(0x55d398326f99059fF775485246999027B3197955),
            IERC20(0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d)
        );
        governor = new LadderGovernor(vault, timelock);
        assertEq(address(governor), predictedGovernor);

        vm.etch(alice, "");
        vm.etch(bob, "");
        vm.etch(grantee, "");
        vm.deal(alice, 20 ether);
        vm.deal(bob, 20 ether);
    }

    function test_launchConfiguration() public view {
        assertEq(vault.feeRecipient(), address(timelock));
        assertEq(vault.curator(), address(timelock));
        assertEq(vault.MARKET(), address(market));
        assertEq(vault.MAX_DEPOSIT(), 10 ether);
        assertEq(vault.validators().length, 4);
        assertEq(address(market.PAYMENT_TOKEN_0()), 0x55d398326f99059fF775485246999027B3197955);
        assertEq(address(market.PAYMENT_TOKEN_1()), 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d);
        assertEq(address(governor.token()), address(vault));
        assertEq(address(governor.timelock()), address(timelock));
        assertEq(timelock.getMinDelay(), 2 days);
    }

    function test_daoVoteEndToEnd() public {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(alice, 7_000);
        vm.prank(bob);
        vault.deposit{value: 4 ether}(bob, 8_000);
        vault.flush(); // staked with a real launch validator
        vm.deal(address(timelock), 1 ether); // treasury BNB, as if fees had been redeemed
        vm.warp(block.timestamp + 2);

        address[] memory targets = new address[](1);
        targets[0] = grantee;
        uint256[] memory values = new uint256[](1);
        values[0] = 1 ether;
        bytes[] memory calldatas = new bytes[](1);
        vm.prank(alice);
        uint256 id = governor.propose(targets, values, calldatas, "Fund the first audit");

        vm.warp(block.timestamp + 2);
        vm.prank(alice);
        governor.castVote(id, 1);
        vm.prank(bob);
        governor.castVote(id, 0);
        (uint256 against, uint256 forVotes,) = governor.proposalVotes(id);
        assertEq(forVotes, vault.getVotes(alice));
        assertEq(against, vault.getVotes(bob));

        vm.warp(governor.proposalDeadline(id) + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Succeeded));
        governor.queue(id);
        vm.warp(block.timestamp + 2 days);
        governor.execute(id);
        assertEq(grantee.balance, 1 ether);
    }
}
