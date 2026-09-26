// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {CohortMarket} from "../../src/CohortMarket.sol";
import {IStakeHub} from "../../src/interfaces/IStakeHub.sol";

/// @title A complete emergency-share sale on BNB Chain mainnet, paid in real USDT
contract CohortMarketForkTest is Test {
    IStakeHub internal constant HUB = IStakeHub(0x0000000000000000000000000000000000002002);
    IERC20 internal constant USDT = IERC20(0x55d398326f99059fF775485246999027B3197955);
    IERC20 internal constant USDC = IERC20(0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d);

    LadderVault internal vault;
    CohortMarket internal market;
    address internal seller = address(uint160(uint256(keccak256("legacy-ladder/fork-test/seller"))));
    address internal buyer = address(uint160(uint256(keccak256("legacy-ladder/fork-test/buyer"))));

    function setUp() public {
        vm.createSelectFork(vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.bnbchain.org")));
        (address[] memory ops,,) = HUB.getValidators(0, 50);
        address[] memory vals = new address[](1);
        for (uint256 i; i < ops.length; ++i) {
            (, bool jailed,) = HUB.getValidatorBasicInfo(ops[i]);
            if (!jailed) {
                vals[0] = ops[i];
                break;
            }
        }
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        vault = new LadderVault(
            LadderVault.Config({
                market: predicted,
                feeRecipient: makeAddr("fee"),
                curator: makeAddr("curator"),
                validators: vals,
                minDeposit: 0.01 ether,
                maxDeposit: 100 ether,
                capInitial: 1_000 ether,
                capGrowthPerEpoch: 500 ether,
                capRemovedAtEpoch: 24,
                epoch: 2_629_746,
                lockEpochs: 120
            })
        );
        market = new CohortMarket(vault, USDT, USDC, 7 days, makeAddr("treasury"), 200, 300);
        vm.etch(seller, "");
        vm.etch(buyer, "");
        vm.deal(seller, 20 ether);
    }

    function test_saleSettlesInRealUsdt() public {
        vm.startPrank(seller);
        (uint256 cohort,, uint256 sharesB) = vault.deposit{value: 10 ether}(seller, 7_000);
        vault.setApprovalForAll(address(market), true);
        vm.stopPrank();
        vault.flush();

        uint256 id = (cohort << 2) | 1;
        deal(address(USDT), buyer, 2_000e18);
        vm.startPrank(buyer);
        USDT.approve(address(market), 2_000e18);
        uint256 offerId = market.makeOffer(id, sharesB, 2_000e18, 0, seller, 7 days);
        vm.stopPrank();

        vm.prank(seller);
        uint256 saleId = market.acceptOffer(offerId, sharesB);
        vm.warp(block.timestamp + 7 days);

        vm.prank(buyer);
        market.collectShares(saleId, buyer);
        vm.prank(seller);
        market.collectPayment(saleId, seller);

        assertEq(vault.balanceOf(buyer, id), sharesB, "buyer holds the emergency shares");
        assertEq(USDT.balanceOf(seller), 2_000e18, "seller paid in real USDT");
        assertEq(USDT.balanceOf(address(market)), 0);
    }
}
