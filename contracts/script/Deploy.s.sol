// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LadderVault} from "../src/LadderVault.sol";
import {CohortMarket} from "../src/CohortMarket.sol";

/// @title Deploys the vault and its market
/// @notice The vault fixes its market address at construction, so the market's address is predicted from the
///         deployer's nonce, handed to the vault, and checked after the market is deployed. The two deployments must
///         be the deployer's next two transactions: nothing may be sent from that address in between.
///
///         Nothing here touches a private key. Sign with your own keystore or hardware wallet, e.g.
///           forge script script/Deploy.s.sol --rpc-url bsc --account <keystore> --broadcast --verify
///
///         Required environment: FEE_RECIPIENT, CURATOR (Safe multisigs), VALIDATORS (comma-separated operator
///         addresses). On BSC mainnet the payment tokens default to USDT and USDC; elsewhere set PAYMENT_TOKEN_0/1.
contract Deploy is Script {
    // Launch parameters (docs/DESIGN.md). Immutable once deployed.
    uint256 internal constant MIN_DEPOSIT = 0.01 ether;
    uint256 internal constant MAX_DEPOSIT = 100 ether;
    uint256 internal constant CAP_INITIAL = 1_000 ether;
    uint256 internal constant CAP_GROWTH_PER_EPOCH = 500 ether;
    uint256 internal constant CAP_REMOVED_AT_EPOCH = 24;

    address internal constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;
    address internal constant BSC_USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;

    function run() external returns (LadderVault vault, CohortMarket market) {
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address curator = vm.envAddress("CURATOR");
        address[] memory validators = vm.envAddress("VALIDATORS", ",");
        (address token0, address token1) = block.chainid == 56
            ? (vm.envOr("PAYMENT_TOKEN_0", BSC_USDT), vm.envOr("PAYMENT_TOKEN_1", BSC_USDC))
            : (vm.envAddress("PAYMENT_TOKEN_0"), vm.envAddress("PAYMENT_TOKEN_1"));

        vm.startBroadcast();
        address deployer = msg.sender;
        address predictedMarket = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);

        vault = new LadderVault(
            LadderVault.Config({
                market: predictedMarket,
                feeRecipient: feeRecipient,
                curator: curator,
                validators: validators,
                minDeposit: MIN_DEPOSIT,
                maxDeposit: MAX_DEPOSIT,
                capInitial: CAP_INITIAL,
                capGrowthPerEpoch: CAP_GROWTH_PER_EPOCH,
                capRemovedAtEpoch: CAP_REMOVED_AT_EPOCH
            })
        );
        market = new CohortMarket(vault, IERC20(token0), IERC20(token1));
        vm.stopBroadcast();

        require(address(market) == predictedMarket, "market not at the address the vault expects");
        require(vault.MARKET() == address(market), "vault market mismatch");

        console2.log("LadderVault  ", address(vault));
        console2.log("CohortMarket ", address(market));
        console2.log("genesis      ", vault.GENESIS());
    }
}
