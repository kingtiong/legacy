// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LadderVault} from "../src/LadderVault.sol";
import {CohortMarket} from "../src/CohortMarket.sol";
import {LadderGovernor} from "../src/LadderGovernor.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title Deploys the DAO treasury, vault, market and DAO governor
/// @notice Four deployments, in this order, as the deployer's next four transactions (nothing may be sent from that
///         address in between, because later addresses are predicted from its nonce):
///           1. TimelockController: the DAO treasury, and the vault's fee recipient and curator. Its only proposer and canceller
///              is the governor (predicted address), anyone may execute a passed proposal after the delay, and it has
///              no admin: its settings change only through its own proposals.
///           2. LadderVault, with the timelock as fee recipient and curator, and the predicted market address. No team
///              wallet or multisig holds any role: depositors govern both through the DAO.
///           3. CohortMarket, which refuses to deploy unless the vault expects it.
///           4. LadderGovernor, which refuses to deploy unless the timelock is the vault's fee recipient and the
///              governor is the timelock's proposer.
///         Every predicted address and role is checked again at the end.
///
///         Nothing here touches a private key. Sign with your own keystore or hardware wallet, e.g.
///           forge script script/Deploy.s.sol --rpc-url bsc --account <keystore> --broadcast --verify
///
///         Environment: none on BSC mainnet, where the validators default to the launch set below and the payment
///         tokens to USDT and USDC; elsewhere set VALIDATORS and PAYMENT_TOKEN_0/1.
contract Deploy is Script {
    // Launch parameters for an unaudited launch (docs/DESIGN.md). Immutable once deployed.
    uint256 internal constant MIN_DEPOSIT = 0.01 ether;
    uint256 internal constant MAX_DEPOSIT = 10 ether;
    uint256 internal constant CAP_INITIAL = 100 ether;
    uint256 internal constant CAP_GROWTH_PER_EPOCH = 50 ether;
    uint256 internal constant CAP_REMOVED_AT_EPOCH = 36;
    /// @notice Wait between a proposal passing and anyone being able to execute it.
    uint256 internal constant TIMELOCK_DELAY = 2 days;

    address internal constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;
    address internal constant BSC_USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;

    // Launch validators on BSC mainnet: established operators, unjailed, over two years old (docs/DESIGN.md).
    address internal constant ANKR = 0xeace91702B20bc6Ee62034eC7f5162D9a94bFbE4;
    address internal constant FIGMENT = 0x477cB5d87144b2a6d93f72e32f5E01a459260D68;
    address internal constant NODEREAL = 0x7d0F8A6D1C8fbF929Dcf4847A31E30d14923Fa31;
    address internal constant THE48CLUB = 0xaACc290a1A4c89F5D7bc29913122F5982916de48;

    function run()
        external
        returns (TimelockController timelock, LadderVault vault, CohortMarket market, LadderGovernor governor)
    {
        address[] memory validators = block.chainid == 56 && !vm.envExists("VALIDATORS")
            ? _launchValidators()
            : vm.envAddress("VALIDATORS", ",");
        (address token0, address token1) = block.chainid == 56
            ? (vm.envOr("PAYMENT_TOKEN_0", BSC_USDT), vm.envOr("PAYMENT_TOKEN_1", BSC_USDC))
            : (vm.envAddress("PAYMENT_TOKEN_0"), vm.envAddress("PAYMENT_TOKEN_1"));

        vm.startBroadcast();
        address deployer = msg.sender;
        uint256 nonce = vm.getNonce(deployer);
        address predictedMarket = vm.computeCreateAddress(deployer, nonce + 2);
        address predictedGovernor = vm.computeCreateAddress(deployer, nonce + 3);

        timelock = _deployTimelock(predictedGovernor);
        vault = _deployVault(predictedMarket, address(timelock), validators);
        market = new CohortMarket(vault, IERC20(token0), IERC20(token1));
        governor = new LadderGovernor(vault, timelock);
        vm.stopBroadcast();

        require(
            address(vault) == vm.computeCreateAddress(deployer, nonce + 1),
            "vault not at the predicted address"
        );
        require(address(market) == predictedMarket, "market not at the address the vault expects");
        require(address(governor) == predictedGovernor, "governor not at the address the timelock expects");
        _check(deployer, timelock, vault, market, governor);

        console2.log("DAO treasury ", address(timelock));
        console2.log("LadderVault  ", address(vault));
        console2.log("CohortMarket ", address(market));
        console2.log("DAO governor ", address(governor));
        console2.log("genesis      ", vault.GENESIS());
    }

    function _deployTimelock(address governor) internal returns (TimelockController) {
        address[] memory proposers = new address[](1);
        proposers[0] = governor;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone may execute a proposal that passed and waited out the delay
        return new TimelockController(TIMELOCK_DELAY, proposers, executors, address(0));
    }

    function _deployVault(address market, address treasury, address[] memory validators)
        internal
        returns (LadderVault)
    {
        return new LadderVault(
            LadderVault.Config({
                market: market,
                feeRecipient: treasury,
                curator: treasury,
                validators: validators,
                minDeposit: MIN_DEPOSIT,
                maxDeposit: MAX_DEPOSIT,
                capInitial: CAP_INITIAL,
                capGrowthPerEpoch: CAP_GROWTH_PER_EPOCH,
                capRemovedAtEpoch: CAP_REMOVED_AT_EPOCH
            })
        );
    }

    function _check(
        address deployer,
        TimelockController timelock,
        LadderVault vault,
        CohortMarket market,
        LadderGovernor governor
    ) internal view {
        require(vault.MARKET() == address(market), "vault market mismatch");
        require(address(market.VAULT()) == address(vault), "market vault mismatch");
        require(vault.feeRecipient() == address(timelock), "fee recipient is not the DAO treasury");
        require(vault.curator() == address(timelock), "curator is not the DAO treasury");
        require(address(governor.timelock()) == address(timelock), "governor timelock mismatch");
        require(address(governor.token()) == address(vault), "governor votes mismatch");
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), address(governor)), "governor cannot propose");
        require(timelock.hasRole(timelock.CANCELLER_ROLE(), address(governor)), "governor cannot cancel");
        require(timelock.hasRole(timelock.EXECUTOR_ROLE(), address(0)), "execution not open");
        require(!timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), deployer), "deployer kept timelock admin");
        require(!timelock.hasRole(timelock.PROPOSER_ROLE(), deployer), "deployer can propose");
        require(timelock.getMinDelay() == TIMELOCK_DELAY, "timelock delay mismatch");
    }

    function _launchValidators() internal pure returns (address[] memory v) {
        v = new address[](4);
        v[0] = ANKR;
        v[1] = FIGMENT;
        v[2] = NODEREAL;
        v[3] = THE48CLUB;
    }
}
