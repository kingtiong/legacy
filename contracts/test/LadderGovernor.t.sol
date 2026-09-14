// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC1155Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {LadderVault} from "../src/LadderVault.sol";
import {LadderGovernor} from "../src/LadderGovernor.sol";
import {DaoTestBase} from "./utils/DaoTestBase.sol";
import {MockStakeCredit} from "./mocks/MockStakeHub.sol";

contract VaultVotesTest is DaoTestBase {
    function test_deposit_givesOneVotePerShare() public {
        (, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        assertEq(vault.getVotes(alice), a + b);
        vm.warp(block.timestamp + 1);
        assertEq(vault.getPastTotalSupply(block.timestamp - 1), a + b);
    }

    function test_votes_areRecordedOverTime() public {
        (, uint256 a1, uint256 b1) = _deposit(alice, 10 ether);
        uint256 t1 = block.timestamp;
        vm.warp(t1 + 100);
        (, uint256 a2, uint256 b2) = _deposit(alice, 5 ether);
        vm.warp(t1 + 200);
        assertEq(vault.getPastVotes(alice, t1), a1 + b1);
        assertEq(vault.getPastVotes(alice, t1 - 1), 0);
        assertEq(vault.getPastVotes(alice, t1 + 150), a1 + b1 + a2 + b2);
    }

    function test_votes_futureLookupReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(LadderVault.FutureLookup.selector, block.timestamp, block.timestamp)
        );
        vault.getPastVotes(alice, block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(LadderVault.FutureLookup.selector, block.timestamp, block.timestamp)
        );
        vault.getPastTotalSupply(block.timestamp);
    }

    function test_clock_isTimestamp() public view {
        assertEq(vault.clock(), block.timestamp);
        assertEq(vault.CLOCK_MODE(), "mode=timestamp");
        assertEq(governor.clock(), block.timestamp);
        assertEq(governor.CLOCK_MODE(), "mode=timestamp");
    }

    function test_feeShares_carryNoVotes() public {
        (, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        uint256 fees = _earnFees();
        assertEq(vault.getVotes(address(timelock)), 0, "treasury cannot vote with fee shares");
        vm.prank(address(timelock));
        vault.safeTransferFrom(address(timelock), bob, 2, fees, "");
        assertEq(vault.getVotes(bob), 0, "fee shares carry no votes wherever they go");
        vm.warp(block.timestamp + 1);
        assertEq(vault.getPastTotalSupply(block.timestamp - 1), a + b, "total votes exclude fee shares");
    }

    function test_claim_burnsVotes() public {
        (, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        _warpToMaturity(0);
        vm.prank(alice);
        vault.requestClaim(_idA(0), a);
        assertEq(vault.getVotes(alice), b);
        vm.warp(block.timestamp + 1);
        assertEq(vault.getPastTotalSupply(block.timestamp - 1), b);
    }

    function test_marketSale_movesVotesThroughEscrow() public {
        (, uint256 a, uint256 b) = _deposit(alice, 10 ether);
        vm.prank(alice);
        vault.setApprovalForAll(address(mkt), true);
        usdt.mint(bob, 1_000e18);
        vm.startPrank(bob);
        usdt.approve(address(mkt), 1_000e18);
        uint256 offerId = mkt.makeOffer(_idB(0), b, 1_000e18, 0, address(0), 30 days);
        vm.stopPrank();

        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        assertEq(vault.getVotes(alice), a, "seller loses the escrowed shares' votes");
        assertEq(vault.getVotes(address(mkt)), b, "escrow holds them, and the market never votes");

        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        assertEq(vault.getVotes(bob), b, "buyer gains the votes on collection");
        assertEq(vault.getVotes(address(mkt)), 0);
    }

    function test_votesInvariant_sumOfHoldersEqualsTotal() public {
        (, uint256 a1, uint256 b1) = _deposit(alice, 10 ether);
        (, uint256 a2, uint256 b2) = _deposit(bob, 3 ether);
        _earnFees();
        vm.warp(block.timestamp + 1);
        uint256 total = vault.getPastTotalSupply(block.timestamp - 1);
        assertEq(total, a1 + b1 + a2 + b2);
        assertEq(total, vault.totalSupply() - vault.totalSupply(2));
    }
}

contract LadderGovernorTest is DaoTestBase {
    // ================================================================ deployment

    function test_deploy_wiring() public view {
        assertEq(vault.feeRecipient(), address(timelock));
        assertEq(vault.curator(), address(timelock), "validators are managed by depositor vote");
        assertEq(address(governor.timelock()), address(timelock));
        assertEq(address(governor.token()), address(vault));
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), address(governor)));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), address(governor)));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), address(0)));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(this)), "deployer holds no admin");
        assertEq(timelock.getMinDelay(), TIMELOCK_DELAY);
        assertEq(governor.votingDelay(), 0);
        assertEq(governor.votingPeriod(), 7 days);
        assertEq(governor.proposalThreshold(), 1e21);
        assertEq(governor.quorumNumerator(), 10);
        assertEq(governor.lateQuorumVoteExtension(), 2 days);
    }

    function test_governor_refusesATimelockThatIsNotTheTreasury() public {
        address[] memory proposers = new address[](1);
        address[] memory executors = new address[](1);
        TimelockController other = new TimelockController(1 days, proposers, executors, address(0));
        vm.expectRevert(LadderGovernor.TimelockMismatch.selector);
        new LadderGovernor(vault, other);
    }

    function test_governor_refusesWhenItIsNotTheProposer() public {
        // A timelock that is the treasury, but whose proposer is someone else.
        vm.prank(address(timelock));
        vault.transferFeeRecipient(address(0xBEEF));
        vm.expectRevert(LadderGovernor.TimelockMismatch.selector);
        new LadderGovernor(vault, timelock);
    }

    function test_timelock_nobodyButTheGovernorCanSchedule() public {
        bytes32 role = timelock.PROPOSER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), role
            )
        );
        timelock.schedule(address(vault), 0, "", bytes32(0), bytes32(0), TIMELOCK_DELAY);
    }

    // ================================================================ lifecycle

    function test_lifecycle_grantFeeSharesByVote() public {
        _deposit(alice, 10 ether);
        _deposit(bob, 5 ether);
        uint256 fees = _earnFees();
        vm.warp(block.timestamp + 1);

        uint256 id = _propose(
            alice,
            address(vault),
            0,
            abi.encodeCall(vault.safeTransferFrom, (address(timelock), grantee, 2, fees, "")),
            "Grant the first fee income to the audit fund"
        );
        assertEq(governor.proposalDescription(id), "Grant the first fee income to the audit fund");
        assertEq(governor.proposalCount(), 1);

        _pass(id, _one(alice));
        _queueAndExecute(id);
        assertEq(vault.balanceOf(grantee, 2), fees, "grantee received the fee shares");

        vm.prank(grantee);
        uint256 claimId = vault.requestClaim(2, fees);
        assertGt(vault.getClaim(claimId).amount, 0, "and can redeem them straight away");
    }

    function test_lifecycle_claimFeesToBnbThenSendBnb() public {
        _deposit(alice, 10 ether);
        uint256 fees = _earnFees();
        vm.warp(block.timestamp + 1);

        // Proposal 1: redeem the fee shares. The claim is paid to the treasury itself.
        uint256 id =
            _propose(alice, address(vault), 0, abi.encodeCall(vault.requestClaim, (2, fees)), "Redeem fees");
        _pass(id, _one(alice));
        _queueAndExecute(id);
        LadderVault.Claim memory c = vault.getClaim(0);
        assertEq(c.owner, address(timelock));
        vm.warp(c.readyAt);
        vault.withdraw(0); // anyone may trigger it; it pays the owner
        assertEq(address(timelock).balance, c.amount, "treasury holds BNB");

        // Proposal 2: send that BNB.
        uint256 id2 = _propose(alice, grantee, c.amount, "", "Pay the grant");
        _pass(id2, _one(alice));
        _queueAndExecute(id2);
        assertEq(grantee.balance, c.amount);
    }

    function test_propose_belowThresholdReverts() public {
        _deposit(carol, 0.5 ether); // 5e20 shares, below the 1e21 threshold
        vm.warp(block.timestamp + 1);
        (address[] memory t, uint256[] memory v, bytes[] memory c) = _proposal(grantee, 0, "");
        uint256 votes = vault.getVotes(carol);
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(IGovernor.GovernorInsufficientProposerVotes.selector, carol, votes, 1e21)
        );
        governor.propose(t, v, c, "spam");
    }

    function test_quorumNotMet_defeated() public {
        _deposit(alice, 1 ether);
        _deposit(bob, 20 ether);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(alice, grantee, 0, "", "tiny turnout");
        _toVoting(id);
        _vote(alice, id, 1); // alice holds under 5% of votes
        vm.warp(governor.proposalDeadline(id) + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Defeated));
    }

    function test_againstVotes_defeat() public {
        _deposit(alice, 10 ether);
        _deposit(bob, 11 ether);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(alice, grantee, 0, "", "contested");
        _toVoting(id);
        _vote(alice, id, 1);
        _vote(bob, id, 0);
        vm.warp(governor.proposalDeadline(id) + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Defeated));
    }

    function test_depositAfterProposal_doesNotCount() public {
        _deposit(alice, 10 ether);
        _deposit(bob, 10 ether);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(alice, grantee, 0, "", "snapshot test");

        // Carol sees the proposal and deposits a lot straight after it.
        vm.warp(block.timestamp + 1);
        vm.prank(carol);
        vault.deposit{value: 1_000 ether}(carol, 7_000);
        _toVoting(id);
        vm.prank(carol);
        uint256 weight = governor.castVote(id, 0);
        assertEq(weight, 0, "votes are fixed when the proposal is created");
    }

    function test_marketSale_cannotVoteTwice() public {
        (,, uint256 b) = _deposit(alice, 10 ether);
        _deposit(bob, 1 ether);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(alice, grantee, 0, "", "double vote");
        _toVoting(id);
        uint256 aliceWeight = vault.getVotes(alice);
        _vote(alice, id, 1);

        vm.prank(alice);
        vault.setApprovalForAll(address(mkt), true);
        usdt.mint(carol, 1_000e18);
        vm.startPrank(carol);
        usdt.approve(address(mkt), 1_000e18);
        uint256 offerId = mkt.makeOffer(_idB(0), b, 1_000e18, 0, address(0), 30 days);
        vm.stopPrank();
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        vm.warp(block.timestamp + 7 days);
        vm.prank(carol);
        mkt.collectShares(saleId, carol);
        assertEq(vault.getVotes(carol), b, "carol holds the shares now");

        // The cooling-off is as long as the voting period, so the vote is already over; and even if it were not,
        // carol's power for this proposal is read at its snapshot, when she held nothing.
        assertEq(governor.getVotes(carol, governor.proposalSnapshot(id)), 0);
        assertEq(governor.getVotes(alice, governor.proposalSnapshot(id)), aliceWeight);
        (uint256 against, uint256 forVotes,) = governor.proposalVotes(id);
        assertEq(forVotes, aliceWeight);
        assertEq(against, 0);
    }

    function test_lateQuorum_extendsTheVote() public {
        _deposit(alice, 10 ether);
        _deposit(bob, 100 ether);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(alice, grantee, 0, "", "late swing");
        _toVoting(id);
        uint256 deadline = governor.proposalDeadline(id);
        vm.warp(deadline - 1 hours);
        _vote(bob, id, 1); // quorum reached in the last hour
        assertEq(governor.proposalDeadline(id), block.timestamp + 2 days, "vote extended by two days");
    }

    // ================================================================ limits of power

    function test_governance_cannotMoveDepositorShares() public {
        (, uint256 a,) = _deposit(alice, 10 ether);
        _deposit(bob, 10 ether);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(
            bob,
            address(vault),
            0,
            abi.encodeCall(vault.safeTransferFrom, (alice, address(timelock), _idA(0), a, "")),
            "Take alice's savings"
        );
        address[] memory voters = new address[](2);
        voters[0] = alice;
        voters[1] = bob;
        _pass(id, voters);
        governor.queue(id);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC1155Errors.ERC1155MissingApprovalForAll.selector, address(timelock), alice
            )
        );
        governor.execute(id);
        assertEq(vault.balanceOf(alice, _idA(0)), a, "even a unanimous vote cannot touch a deposit");
    }

    function test_governance_canHandTheTreasuryToANewDao() public {
        _deposit(alice, 10 ether);
        vm.warp(block.timestamp + 1);
        address next = makeAddr("nextDao");
        uint256 id = _propose(
            alice, address(vault), 0, abi.encodeCall(vault.transferFeeRecipient, (next)), "Migrate treasury"
        );
        _pass(id, _one(alice));
        _queueAndExecute(id);
        assertEq(vault.pendingFeeRecipient(), next);
        vm.prank(next);
        vault.acceptFeeRecipient();
        assertEq(vault.feeRecipient(), next);
    }

    function test_curator_addValidatorByVote() public {
        _deposit(alice, 10 ether);
        vm.warp(block.timestamp + 1);
        address v4 = makeAddr("validator4");
        hub.createValidator{value: 2_000 ether}(v4);

        vm.expectRevert(LadderVault.NotCurator.selector);
        vault.addValidator(v4); // nobody outside the DAO

        uint256 id =
            _propose(alice, address(vault), 0, abi.encodeCall(vault.addValidator, (v4)), "List validator 4");
        _pass(id, _one(alice));
        _queueAndExecute(id);
        assertTrue(vault.isValidator(v4));
    }

    function test_curator_redelegateByVoteStaysRateLimited() public {
        _deposit(alice, 10 ether);
        vault.flush();
        vm.warp(block.timestamp + 1);
        address from = vault.validators()[0];
        MockStakeCredit credit = _credit(from);
        if (credit.balanceOf(address(vault)) == 0) from = vault.validators()[1];
        credit = _credit(from);
        address to = from == v1 ? v2 : v1;
        uint256 all = credit.balanceOf(address(vault));

        // A vote to move all stake at once passes, but the vault's 10% per 7 days limit still applies on execution.
        uint256 id =
            _propose(alice, address(vault), 0, abi.encodeCall(vault.redelegate, (from, to, all)), "Move all");
        _pass(id, _one(alice));
        governor.queue(id);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectPartialRevert(LadderVault.RedelegateLimitExceeded.selector);
        governor.execute(id);
        assertEq(credit.balanceOf(address(vault)), all, "stake did not move");
    }

    function test_settingsChangeOnlyByVote() public {
        vm.expectRevert(abi.encodeWithSelector(IGovernor.GovernorOnlyExecutor.selector, address(this)));
        governor.updateQuorumNumerator(1);
        vm.expectRevert(
            abi.encodeWithSelector(TimelockController.TimelockUnauthorizedCaller.selector, address(this))
        );
        timelock.updateDelay(0);
    }
}
