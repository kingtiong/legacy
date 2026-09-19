// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {CohortMarket} from "../../src/CohortMarket.sol";
import {LadderGovernor} from "../../src/LadderGovernor.sol";
import {MockStablecoin} from "../mocks/MockStablecoin.sol";
import {VaultTestBase} from "./VaultTestBase.sol";

/// @dev Deploys the full stack in the deploy script's order: timelock (DAO treasury, fee recipient and curator), vault,
///      market, governor, with
///      the market and governor addresses predicted from the nonce.
abstract contract DaoTestBase is VaultTestBase {
    uint256 internal constant TIMELOCK_DELAY = 2 days;

    TimelockController internal timelock;
    CohortMarket internal mkt;
    LadderGovernor internal governor;
    MockStablecoin internal usdt;
    MockStablecoin internal usdc;

    address internal grantee = makeAddr("grantee");
    address internal carol = makeAddr("carol");

    function setUp() public virtual override {
        super.setUp();
        usdt = new MockStablecoin("USDT");
        usdc = new MockStablecoin("USDC");

        uint256 nonce = vm.getNonce(address(this));
        address predictedMarket = vm.computeCreateAddress(address(this), nonce + 2);
        address predictedGovernor = vm.computeCreateAddress(address(this), nonce + 3);

        address[] memory proposers = new address[](1);
        proposers[0] = predictedGovernor;
        address[] memory executors = new address[](1);
        timelock = new TimelockController(TIMELOCK_DELAY, proposers, executors, address(0));

        address[] memory vals = new address[](3);
        vals[0] = v1;
        vals[1] = v2;
        vals[2] = v3;
        vault = new LadderVault(
            LadderVault.Config({
                market: predictedMarket,
                feeRecipient: address(timelock),
                curator: address(timelock),
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
        mkt = new CohortMarket(vault, usdt, usdc, 7 days);
        governor = new LadderGovernor(vault, timelock);
        assertEq(address(mkt), predictedMarket);
        assertEq(address(governor), predictedGovernor);
        market = address(mkt);
        feeRecipient = address(timelock);
        curator = address(timelock);

        vm.deal(carol, 10_000 ether);
    }

    /// @dev Rewards the pool and charges the fee, so the treasury holds fee shares.
    function _earnFees() internal returns (uint256 feeShares) {
        vault.flush();
        hub.reward{value: 100 ether}(v1);
        vault.accrueFee();
        feeShares = vault.balanceOf(address(timelock), vault.FEE_SHARES_ID());
        assertGt(feeShares, 0, "treasury earned fee shares");
    }

    function _proposal(address target, uint256 value, bytes memory data)
        internal
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        targets = new address[](1);
        targets[0] = target;
        values = new uint256[](1);
        values[0] = value;
        calldatas = new bytes[](1);
        calldatas[0] = data;
    }

    function _propose(
        address proposer,
        address target,
        uint256 value,
        bytes memory data,
        string memory description
    ) internal returns (uint256 id) {
        (address[] memory t, uint256[] memory v, bytes[] memory c) = _proposal(target, value, data);
        vm.prank(proposer);
        id = governor.propose(t, v, c, description);
    }

    function _toVoting(uint256 id) internal {
        vm.warp(governor.proposalSnapshot(id) + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Active));
    }

    function _vote(address who, uint256 id, uint8 support) internal {
        vm.prank(who);
        governor.castVote(id, support);
    }

    function _pass(uint256 id, address[] memory voters) internal {
        _toVoting(id);
        for (uint256 i; i < voters.length; ++i) {
            _vote(voters[i], id, 1);
        }
        vm.warp(governor.proposalDeadline(id) + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Succeeded), "proposal passed");
    }

    function _queueAndExecute(uint256 id) internal {
        governor.queue(id);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        governor.execute(id);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Executed));
    }

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }
}
