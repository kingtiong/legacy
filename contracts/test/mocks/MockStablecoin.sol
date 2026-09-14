// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice An 18-decimal stablecoin, like BSC's USDT and USDC, that can blacklist addresses (as an upgradeable
///         issuer could add) and optionally charge a fee on transfer.
contract MockStablecoin is ERC20 {
    mapping(address => bool) public blacklisted;
    uint256 public feeBps;

    error Blacklisted(address account);

    constructor(string memory symbol) ERC20(symbol, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlacklisted(address account, bool value) external {
        blacklisted[account] = value;
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blacklisted[from]) revert Blacklisted(from);
        if (blacklisted[to]) revert Blacklisted(to);
        if (feeBps != 0 && from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0xfee), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}
