// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title BNB Chain native staking, as used by Legacy Ladder
/// @notice The subset of BNB Chain's StakeHub system contract (0x...2002) that the vault relies on.
///         Signatures match bnb-chain/bsc-genesis-contract. Every behaviour assumed here is pinned by
///         test/fork/StakeHubAssumptions.t.sol, which runs against a live mainnet fork.
interface IStakeHub {
    /// @dev Reverts below `minDelegationBNBChange` (1 BNB at time of writing), and for jailed validators.
    function delegate(address operatorAddress, bool delegateVotePower) external payable;

    /// @dev No minimum amount. Queues an unbond request that unlocks after `unbondPeriod`.
    function undelegate(address operatorAddress, uint256 shares) external;

    /// @dev Moves stake between validators without unbonding. Needs at least 1 BNB moved; charges
    ///      `bnbAmount * redelegateFeeRate / 100000`. The source may be jailed; the destination may not.
    function redelegate(address srcValidator, address dstValidator, uint256 shares, bool delegateVotePower)
        external;

    /// @dev Pays unlocked requests to msg.sender with a gas stipend of `transferGasLimit` (5000 at time of
    ///      writing). A receiver that needs more gas than that makes the claim revert. `requestNumber` 0 = all.
    function claim(address operatorAddress, uint256 requestNumber) external;

    function getValidators(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory operatorAddrs, address[] memory creditAddrs, uint256 totalLength);

    function getValidatorCreditContract(address operatorAddress)
        external
        view
        returns (address creditContract);

    function getValidatorBasicInfo(address operatorAddress)
        external
        view
        returns (uint256 createdTime, bool jailed, uint256 jailUntil);

    function minDelegationBNBChange() external view returns (uint256);

    function unbondPeriod() external view returns (uint256);

    function transferGasLimit() external view returns (uint256);
}

/// @notice Per-validator share token minted by StakeHub. Not transferable; its BNB value grows as rewards accrue.
interface IStakeCredit {
    function balanceOf(address account) external view returns (uint256);

    function getPooledBNBByShares(uint256 shares) external view returns (uint256);

    function getSharesByPooledBNB(uint256 bnbAmount) external view returns (uint256);

    function getPooledBNB(address account) external view returns (uint256);

    function pendingUnbondRequest(address delegator) external view returns (uint256);

    function claimableUnbondRequest(address delegator) external view returns (uint256);

    function lockedBNBs(address delegator, uint256 number) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);
}
