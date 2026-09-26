// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CohortMarket} from "../src/CohortMarket.sol";
import {MockStablecoin} from "./mocks/MockStablecoin.sol";
import {MarketTestBase} from "./utils/MarketTestBase.sol";

/// @notice The two fees. A buyer pays the price plus 2%, so a seller always receives exactly what was agreed; a
///         seller who cancels within the cooling-off pays 3%, half to the buyer whose money sat locked and half to
///         the DAO. Both go nowhere else, and a cancelled sale charges the buyer nothing.
contract MarketFeesTest is MarketTestBase {
    address internal carol = makeAddr("carol");

    uint256 internal constant PRICE = 1_000e18;
    uint256 internal constant TRADE_FEE = 20e18; // 2% of the price, paid by the buyer
    uint256 internal constant CANCEL_FEE = 30e18; // 3% of the price, paid by a cancelling seller

    function _sale(uint256 bnb) internal returns (uint256 cohort, uint256 b, uint256 saleId) {
        (cohort, b) = _sellerWithShares(alice, bnb);
        uint256 offerId = _offer(bob, _idB(cohort), b, PRICE, address(0));
        vm.prank(alice);
        saleId = mkt.acceptOffer(offerId, b);
    }

    function _armCancel(address seller, uint256 amount) internal {
        usdt.mint(seller, amount);
        vm.prank(seller);
        usdt.approve(address(mkt), amount);
    }

    function test_buyerPaysPricePlusFee_sellerReceivesThePrice() public {
        (,, uint256 saleId) = _sale(10 ether);
        assertEq(usdt.balanceOf(bob), 0, "the buyer escrowed the price and the fee");
        assertEq(usdt.balanceOf(address(mkt)), PRICE + TRADE_FEE);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        mkt.collectPayment(saleId, alice);
        assertEq(usdt.balanceOf(alice), PRICE, "exactly what was agreed, nothing deducted");
        assertEq(usdt.balanceOf(treasury), TRADE_FEE, "the fee went to the DAO");
        assertEq(usdt.balanceOf(address(mkt)), 0, "escrow empty to the wei");
    }

    function test_feeCanBeSweptByAnyone_whenTheSellerNeverCollects() public {
        (,, uint256 saleId) = _sale(10 ether);
        vm.warp(block.timestamp + 7 days);

        vm.prank(carol);
        mkt.settleFee(saleId);
        assertEq(usdt.balanceOf(treasury), TRADE_FEE);
        assertEq(usdt.balanceOf(address(mkt)), PRICE, "the seller's money is still theirs to collect");

        vm.prank(carol);
        vm.expectRevert(CohortMarket.FeeNotDue.selector);
        mkt.settleFee(saleId);

        // Collecting afterwards still pays the seller in full and does not double-charge the fee.
        vm.prank(alice);
        mkt.collectPayment(saleId, alice);
        assertEq(usdt.balanceOf(alice), PRICE);
        assertEq(usdt.balanceOf(treasury), TRADE_FEE);
    }

    function test_feeIsNotDueBeforeTheCoolingOffEnds() public {
        (,, uint256 saleId) = _sale(10 ether);
        vm.expectRevert(
            abi.encodeWithSelector(CohortMarket.CoolingOffActive.selector, block.timestamp + 7 days)
        );
        mkt.settleFee(saleId);
    }

    function test_cancellingCostsTheSeller_andPaysTheBuyerForTheWait() public {
        (uint256 cohort, uint256 b, uint256 saleId) = _sale(10 ether);
        uint256 offerId = mkt.getSale(saleId).offerId;
        _armCancel(alice, CANCEL_FEE);

        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        mkt.cancelSale(saleId);

        assertEq(vault.balanceOf(alice, _idB(cohort)), b, "shares back");
        assertEq(usdt.balanceOf(alice), 0, "the seller paid the whole 3%");
        assertEq(usdt.balanceOf(treasury), CANCEL_FEE / 2, "half of it to the DAO");
        assertEq(mkt.getOffer(offerId).refundable, PRICE + TRADE_FEE + CANCEL_FEE / 2);

        vm.prank(bob);
        mkt.withdrawOffer(offerId, bob);
        assertEq(usdt.balanceOf(bob), PRICE + TRADE_FEE + CANCEL_FEE / 2, "1,035: more than whole");
        assertEq(usdt.balanceOf(address(mkt)), 0);
    }

    function test_aSellerWhoCannotPayTheFeeCannotCancel_soTheSaleCompletes() public {
        (uint256 cohort, uint256 b, uint256 saleId) = _sale(10 ether);

        // No stablecoin, no approval: the cancellation simply fails.
        vm.prank(alice);
        vm.expectRevert();
        mkt.cancelSale(saleId);

        // Holding it without approving is not enough either.
        usdt.mint(alice, CANCEL_FEE);
        vm.prank(alice);
        vm.expectRevert();
        mkt.cancelSale(saleId);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(CohortMarket.CoolingOffOver.selector);
        mkt.cancelSale(saleId);

        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        assertEq(vault.balanceOf(bob, _idB(cohort)), b, "the deal went through");
    }

    function test_cancelledSaleChargesTheBuyerNothing() public {
        (,, uint256 saleId) = _sale(10 ether);
        uint256 offerId = mkt.getSale(saleId).offerId;
        _armCancel(alice, CANCEL_FEE);
        vm.prank(alice);
        mkt.cancelSale(saleId);

        vm.warp(block.timestamp + 7 days);
        vm.prank(carol);
        vm.expectRevert(CohortMarket.SaleClosed.selector);
        mkt.settleFee(saleId);

        vm.prank(bob);
        mkt.withdrawOffer(offerId, bob);
        assertEq(usdt.balanceOf(treasury), CANCEL_FEE / 2, "only the cancellation half, never the trade fee");
    }

    /// @notice Partial fills split the escrowed fee the same way they split the price, and the last one takes the
    ///         remainder, so nothing is ever stranded here.
    function test_partialFillsEmptyTheEscrowExactly() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 odd = 999e18 + 7; // a price that does not divide cleanly
        uint256 offerId = _offer(bob, _idB(cohort), b, odd, address(0));

        vm.startPrank(alice);
        uint256 s1 = mkt.acceptOffer(offerId, b / 3);
        uint256 s2 = mkt.acceptOffer(offerId, b - b / 3);
        vm.stopPrank();
        assertEq(mkt.getOffer(offerId).remainingPayment, 0);
        assertEq(mkt.getOffer(offerId).remainingFee, 0, "no fee dust left behind");
        assertEq(mkt.getSale(s1).payment + mkt.getSale(s2).payment, odd);
        assertEq(mkt.getSale(s1).fee + mkt.getSale(s2).fee, _tradeFee(odd));

        vm.warp(block.timestamp + 7 days);
        vm.startPrank(alice);
        mkt.collectPayment(s1, alice);
        mkt.collectPayment(s2, alice);
        vm.stopPrank();
        assertEq(usdt.balanceOf(alice), odd);
        assertEq(usdt.balanceOf(treasury), _tradeFee(odd));
        assertEq(usdt.balanceOf(address(mkt)), 0, "escrow empty to the wei");
    }

    function test_listingPathChargesTheSameFees() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        vm.prank(alice);
        uint256 listingId = mkt.listShares(_idB(cohort), b, PRICE, 0, 7 days);
        _fund(usdt, bob, PRICE);
        vm.prank(bob);
        uint256 saleId = mkt.buyListing(listingId, b);
        assertEq(usdt.balanceOf(address(mkt)), PRICE + TRADE_FEE);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        mkt.collectPayment(saleId, alice);
        assertEq(usdt.balanceOf(alice), PRICE);
        assertEq(usdt.balanceOf(treasury), TRADE_FEE);
    }

    function test_feeRatesAreFixedAtDeploymentAndCapped() public {
        assertEq(mkt.TRADE_FEE_BPS(), 200);
        assertEq(mkt.CANCEL_FEE_BPS(), 300);
        assertEq(mkt.FEE_RECIPIENT(), treasury);

        // Both checks come before the market asks the vault whether it is expected, so the existing vault serves.
        vm.expectRevert(CohortMarket.FeeTooHigh.selector);
        new CohortMarket(vault, usdt, usdc, 7 days, treasury, 301, 300);
    }

    function test_treasuryAddressIsRequired() public {
        vm.expectRevert(CohortMarket.ZeroAddress.selector);
        new CohortMarket(vault, usdt, usdc, 7 days, address(0), 200, 300);
    }
}
