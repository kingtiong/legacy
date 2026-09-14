// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {
    GovernorCountingSimple
} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {
    GovernorPreventLateQuorum
} from "@openzeppelin/contracts/governance/extensions/GovernorPreventLateQuorum.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorStorage} from "@openzeppelin/contracts/governance/extensions/GovernorStorage.sol";
import {
    GovernorTimelockControl
} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {
    GovernorVotesQuorumFraction
} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {LadderVault} from "./LadderVault.sol";

/// @title Legacy Ladder DAO
/// @notice Depositors govern the protocol's fee income. Voting power is the retirement and emergency shares each
///         address held when a proposal's vote opened. Passed proposals are executed by the timelock, which is the
///         vault's fee recipient and so holds the treasury.
/// @dev    Stock OpenZeppelin governance, composed without changes:
///         - Settings: no voting delay, 7 day voting period, proposal threshold of 1e21 shares (1 BNB at launch).
///         - Quorum: 10% of all voting shares at the snapshot; for-votes must beat against-votes.
///         - Late quorum: a vote that reaches quorum near its end runs at least 2 more days.
///         - Timelock: passed proposals wait out the timelock's delay (2 days at deployment) before anyone may execute.
///         - Storage: proposals are enumerable on-chain, and their descriptions stored, so the website needs no indexer.
///         What governance can reach is bounded by the vault: no role in it can move depositors' shares, change
///         maturity, or stop withdrawals. Settings, quorum and the timelock delay can only be changed by a passed vote.
contract LadderGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorStorage,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorPreventLateQuorum,
    GovernorTimelockControl
{
    /// @notice Zero: voting power is fixed at the moment a proposal is created, so nobody can deposit after seeing a
    ///         proposal and vote with it. (The usual delay exists for delegation, which this DAO does not have.)
    uint48 public constant INITIAL_VOTING_DELAY = 0;
    uint32 public constant INITIAL_VOTING_PERIOD = 7 days;
    uint256 public constant INITIAL_PROPOSAL_THRESHOLD = 1e21;
    uint256 public constant INITIAL_QUORUM_PERCENT = 10;
    uint48 public constant INITIAL_LATE_QUORUM_EXTENSION = 2 days;

    mapping(uint256 proposalId => string) public proposalDescription;

    error TimelockMismatch();

    constructor(LadderVault vault, TimelockController timelock)
        Governor("Legacy Ladder DAO")
        GovernorSettings(INITIAL_VOTING_DELAY, INITIAL_VOTING_PERIOD, INITIAL_PROPOSAL_THRESHOLD)
        GovernorVotes(IVotes(address(vault)))
        GovernorVotesQuorumFraction(INITIAL_QUORUM_PERCENT)
        GovernorPreventLateQuorum(INITIAL_LATE_QUORUM_EXTENSION)
        GovernorTimelockControl(timelock)
    {
        // Refuse to exist unless the timelock this governor controls is the vault's treasury, and this governor is
        // the only one that can propose to it.
        if (vault.feeRecipient() != address(timelock)) revert TimelockMismatch();
        if (!timelock.hasRole(timelock.PROPOSER_ROLE(), address(this))) revert TimelockMismatch();
    }

    // ---------------------------------------------------------------- required overrides

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function quorum(uint256 timepoint)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(timepoint);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalDeadline(uint256 proposalId)
        public
        view
        override(Governor, GovernorPreventLateQuorum)
        returns (uint256)
    {
        return super.proposalDeadline(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function _propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        address proposer
    ) internal override(Governor, GovernorStorage) returns (uint256 proposalId) {
        proposalId = super._propose(targets, values, calldatas, description, proposer);
        proposalDescription[proposalId] = description;
    }

    function _tallyUpdated(uint256 proposalId) internal override(Governor, GovernorPreventLateQuorum) {
        super._tallyUpdated(proposalId);
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
}
