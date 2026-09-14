// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";

interface IStakeHubInfo {
    struct Description {
        string moniker;
        string identity;
        string website;
        string details;
    }

    struct Commission {
        uint64 rate;
        uint64 maxRate;
        uint64 maxChangeRate;
    }

    function getValidators(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory operatorAddrs, address[] memory creditAddrs, uint256 totalLength);
    function getValidatorBasicInfo(address operator)
        external
        view
        returns (uint256 createdTime, bool jailed, uint256 jailUntil);
    function getValidatorDescription(address operator) external view returns (Description memory);
    function getValidatorCommission(address operator) external view returns (Commission memory);
    function getValidatorRewardRecord(address operator, uint256 index) external view returns (uint256);
    function getValidatorTotalPooledBNBRecord(address operator, uint256 index) external view returns (uint256);
}

interface ICreditInfo {
    function totalPooledBNB() external view returns (uint256);
}

/// @title Read-only report of every BNB Chain validator, for choosing and reviewing the vault's validator list
/// @notice forge script script/ValidatorReport.s.sol --rpc-url https://bsc-dataseed.bnbchain.org
///         One CSV line per validator: operator, name, jailed, age in days, commission and maximum commission (bps),
///         total pooled BNB, and delegator APR over the last 7 days (bps, after commission).
contract ValidatorReport is Script {
    IStakeHubInfo internal constant HUB = IStakeHubInfo(0x0000000000000000000000000000000000002002);

    function run() external view {
        (address[] memory ops, address[] memory credits,) = HUB.getValidators(0, 500);
        uint256 today = block.timestamp / 1 days;
        console2.log("operator,name,jailed,ageDays,commissionBps,maxCommissionBps,pooledBnb,apr7dBps,website");
        for (uint256 i; i < ops.length; ++i) {
            (uint256 created, bool jailed,) = HUB.getValidatorBasicInfo(ops[i]);
            IStakeHubInfo.Description memory d = HUB.getValidatorDescription(ops[i]);
            IStakeHubInfo.Commission memory c = HUB.getValidatorCommission(ops[i]);
            uint256 pooled = ICreditInfo(credits[i]).totalPooledBNB();

            uint256 rewards;
            uint256 pooledSum;
            for (uint256 k = 1; k <= 7; ++k) {
                rewards += HUB.getValidatorRewardRecord(ops[i], today - k);
                pooledSum += HUB.getValidatorTotalPooledBNBRecord(ops[i], today - k);
            }
            // rewards/7 per day over average pool, annualised
            uint256 apr = pooledSum == 0 ? 0 : (rewards * 365 * 10_000) / pooledSum;

            console2.log(
                string.concat(
                    vm.toString(ops[i]),
                    ",",
                    d.moniker,
                    ",",
                    jailed ? "yes" : "no",
                    ",",
                    vm.toString(created == 0 ? 0 : (block.timestamp - created) / 1 days),
                    ",",
                    vm.toString(uint256(c.rate)),
                    ",",
                    vm.toString(uint256(c.maxRate)),
                    ",",
                    vm.toString(pooled / 1 ether),
                    ",",
                    vm.toString(apr),
                    ",",
                    d.website
                )
            );
        }
    }
}
