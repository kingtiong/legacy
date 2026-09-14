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
///         Required environment: FEE_RECIPIENT and CURATOR (Safe multisigs). On BSC mainnet the validators default to
///         the launch set below and the payment tokens to USDT and USDC; elsewhere set VALIDATORS and
///         PAYMENT_TOKEN_0/1.
contract Deploy is Script {
    // Launch parameters for an unaudited launch (docs/DESIGN.md). Immutable once deployed.
    uint256 internal constant MIN_DEPOSIT = 0.01 ether;
    uint256 internal constant MAX_DEPOSIT = 10 ether;
    uint256 internal constant CAP_INITIAL = 100 ether;
    uint256 internal constant CAP_GROWTH_PER_EPOCH = 50 ether;
    uint256 internal constant CAP_REMOVED_AT_EPOCH = 36;

    address internal constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;
    address internal constant BSC_USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;

    // Launch validators on BSC mainnet: established operators, unjailed, over two years old (docs/DESIGN.md).
    address internal constant ANKR = 0xeace91702B20bc6Ee62034eC7f5162D9a94bFbE4;
    address internal constant FIGMENT = 0x477cB5d87144b2a6d93f72e32f5E01a459260D68;
    address internal constant NODEREAL = 0x7d0F8A6D1C8fbF929Dcf4847A31E30d14923Fa31;
    address internal constant THE48CLUB = 0xaACc290a1A4c89F5D7bc29913122F5982916de48;

    function run() external returns (LadderVault vault, CohortMarket market) {
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address curator = vm.envAddress("CURATOR");
        address[] memory validators = block.chainid == 56 && !vm.envExists("VALIDATORS")
            ? _launchValidators()
            : vm.envAddress("VALIDATORS", ",");
        if (block.chainid == 56) {
            // Both roles are fixed into the contracts' behaviour; on mainnet they must be multisig contracts, so a
            // typo or a plain wallet address can never be baked in.
            require(feeRecipient.code.length != 0, "FEE_RECIPIENT must be a Safe (contract) on mainnet");
            require(curator.code.length != 0, "CURATOR must be a Safe (contract) on mainnet");
        }
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

    function _launchValidators() internal pure returns (address[] memory v) {
        v = new address[](4);
        v[0] = ANKR;
        v[1] = FIGMENT;
        v[2] = NODEREAL;
        v[3] = THE48CLUB;
    }
}
