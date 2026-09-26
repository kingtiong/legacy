// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LadderVault} from "../src/LadderVault.sol";
import {CohortMarket} from "../src/CohortMarket.sol";
import {MarketTestBase} from "./utils/MarketTestBase.sol";

/// @notice Seller-initiated listings: a holder escrows emergency shares at a fixed stablecoin price, a buyer pays,
///         and the purchase becomes an ordinary sale with the same cooling-off, cancellation and collection rules.
contract CohortMarketListingsTest is MarketTestBase {
    function _list(address seller, uint256 bnb, uint256 price)
        internal
        returns (uint256 cohort, uint256 b, uint256 id)
    {
        (cohort, b) = _sellerWithShares(seller, bnb);
        vm.prank(seller);
        id = mkt.listShares(_idB(cohort), b, price, 0, 7 days);
    }

    function _pay(address buyer, uint256 amount) internal {
        _fund(usdt, buyer, amount);
    }

    function test_listing_fullPurchase() public {
        (uint256 cohort, uint256 b, uint256 id) = _list(alice, 10 ether, 1_000e18);
        assertEq(vault.balanceOf(address(mkt), _idB(cohort)), b, "listed shares escrowed");
        assertEq(vault.balanceOf(alice, _idB(cohort)), 0);

        _pay(bob, 1_000e18);
        vm.prank(bob);
        uint256 saleId = mkt.buyListing(id, b);
        assertEq(usdt.balanceOf(address(mkt)), 1_020e18, "the price and the buyer's 2% fee, both escrowed");

        uint256 endsAt = block.timestamp + 7 days;
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CohortMarket.CoolingOffActive.selector, endsAt));
        mkt.collectShares(saleId, bob);

        vm.warp(endsAt);
        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        vm.prank(alice);
        mkt.collectPayment(saleId, alice);
        assertEq(vault.balanceOf(bob, _idB(cohort)), b);
        assertEq(usdt.balanceOf(alice), 1_000e18, "the seller receives exactly the agreed price");
        assertEq(usdt.balanceOf(treasury), 20e18, "the fee goes to the DAO treasury");
        assertEq(usdt.balanceOf(address(mkt)), 0);
        assertEq(vault.balanceOf(address(mkt), _idB(cohort)), 0);
        assertEq(mkt.getListing(id).remainingShares, 0);
    }

    function test_listing_partialPurchasesArePricedProRata_finalTakesTheRest() public {
        (, uint256 b, uint256 id) = _list(alice, 10 ether, 999e18);
        _pay(bob, 999e18);
        vm.startPrank(bob);
        uint256 s1 = mkt.buyListing(id, b / 3);
        uint256 s2 = mkt.buyListing(id, b - b / 3);
        vm.stopPrank();
        assertEq(mkt.getSale(s1).payment + mkt.getSale(s2).payment, 999e18, "sum of parts is the price");
        assertApproxEqAbs(mkt.getSale(s1).payment, 333e18, 1e18);
        assertEq(mkt.getListing(id).remainingPrice, 0);
    }

    function test_listing_sellerCancelsWithinCoolingOff_buyerGetsRefund() public {
        (uint256 cohort, uint256 b, uint256 id) = _list(alice, 10 ether, 1_000e18);
        _pay(bob, 1_000e18);
        vm.prank(bob);
        uint256 saleId = mkt.buyListing(id, b);

        vm.prank(bob);
        vm.expectRevert(CohortMarket.NotSeller.selector);
        mkt.cancelSale(saleId);

        usdt.mint(alice, 30e18);
        vm.prank(alice);
        usdt.approve(address(mkt), 30e18);
        vm.prank(alice);
        mkt.cancelSale(saleId);
        assertEq(vault.balanceOf(alice, _idB(cohort)), b, "shares back to the seller");

        uint256 offerId = mkt.getSale(saleId).offerId;
        vm.prank(bob);
        mkt.withdrawOffer(offerId, bob);
        assertEq(usdt.balanceOf(bob), 1_035e18, "buyer refunded in full, plus 1.5% for the wait");
        assertEq(usdt.balanceOf(treasury), 15e18, "the treasury takes the other 1.5%");
        assertEq(usdt.balanceOf(address(mkt)), 0);
    }

    function test_listing_cancelReturnsUnsoldShares_onlyBySeller() public {
        (uint256 cohort, uint256 b, uint256 id) = _list(alice, 10 ether, 1_000e18);
        _pay(bob, 1_000e18);
        vm.prank(bob);
        mkt.buyListing(id, b / 2);

        vm.prank(bob);
        vm.expectRevert(CohortMarket.NotListingSeller.selector);
        mkt.cancelListing(id, bob);

        vm.prank(alice);
        mkt.cancelListing(id, alice);
        assertEq(vault.balanceOf(alice, _idB(cohort)), b - b / 2, "unsold part returned");
        vm.prank(alice);
        vm.expectRevert(CohortMarket.ListingClosed.selector);
        mkt.cancelListing(id, alice);
        vm.prank(bob);
        vm.expectRevert(CohortMarket.InvalidAmount.selector);
        mkt.buyListing(id, 1);
    }

    function test_listing_expiredCannotBeBought_butCanBeReclaimed() public {
        (uint256 cohort, uint256 b, uint256 id) = _list(alice, 10 ether, 1_000e18);
        vm.warp(block.timestamp + 7 days);
        _pay(bob, 1_000e18);
        vm.prank(bob);
        vm.expectRevert(CohortMarket.OfferExpired.selector);
        mkt.buyListing(id, b);
        vm.prank(alice);
        mkt.cancelListing(id, alice);
        assertEq(vault.balanceOf(alice, _idB(cohort)), b);
    }

    function test_listing_rejectsRetirementFeeAndBadTerms() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        vm.startPrank(alice);
        vm.expectRevert(CohortMarket.NotEmergencyShare.selector);
        mkt.listShares(_idA(cohort), 1, 1, 0, 1 days);
        vm.expectRevert(CohortMarket.NotEmergencyShare.selector);
        mkt.listShares(2, 1, 1, 0, 1 days);
        vm.expectRevert(CohortMarket.InvalidAmount.selector);
        mkt.listShares(_idB(cohort), b, 0, 0, 1 days);
        vm.expectRevert(CohortMarket.InvalidDuration.selector);
        mkt.listShares(_idB(cohort), b, 1, 0, 31 days);
        vm.expectRevert(CohortMarket.InvalidToken.selector);
        mkt.listShares(_idB(cohort), b, 1, 2, 1 days);
        vm.expectRevert(CohortMarket.SaleTooSmall.selector);
        mkt.listShares(_idB(cohort), 1, 1, 0, 1 days);
        vm.stopPrank();
    }

    function test_listing_needsApproval() public {
        vm.prank(alice);
        (uint256 cohort,, uint256 b) = vault.deposit{value: 10 ether}(alice, 7_000);
        vm.prank(alice);
        vm.expectRevert();
        mkt.listShares(_idB(cohort), b, 1_000e18, 0, 1 days);
    }

    function test_listing_closes7DaysBeforeMaturity() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 maturesAt = vault.maturityOf(cohort);
        vm.warp(maturesAt - 10 days);
        vm.prank(alice);
        uint256 id = mkt.listShares(_idB(cohort), b, 1_000e18, 0, 7 days);
        vm.warp(maturesAt - 7 days);
        _pay(bob, 1_000e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CohortMarket.CohortClosed.selector, maturesAt));
        mkt.buyListing(id, b);
    }

    function test_listing_unsoldSharesMaturedInEscrow_sellerGetsBnb() public {
        vm.prank(alice);
        (uint256 cohort,, uint256 b) = vault.deposit{value: 10 ether}(alice, 7_000);
        vm.prank(alice);
        vault.setApprovalForAll(address(mkt), true);
        // A listing made a month before the cohort closes, left unsold until well after maturity.
        vm.warp(vault.maturityOf(cohort) - 30 days);
        vm.prank(alice);
        uint256 id = mkt.listShares(_idB(cohort), b, 1_000e18, 0, 7 days);
        vm.warp(vault.maturityOf(cohort) + 1 days);

        vm.prank(alice);
        mkt.cancelListing(id, alice);
        CohortMarket.Listing memory l = mkt.getListing(id);
        assertTrue(l.claimOpened, "matured shares redeemed into a claim");
        LadderVault.Claim memory c = vault.getClaim(l.claimId);
        vm.warp(c.readyAt);
        uint256 before = alice.balance;
        vm.prank(alice);
        mkt.withdrawListingClaim(id, alice);
        assertEq(alice.balance - before, c.amount, "seller receives the BNB");
    }

    function test_listing_feeOnTransferTokenRejectedOnPurchase() public {
        (, uint256 b, uint256 id) = _list(alice, 10 ether, 1_000e18);
        usdt.setFeeBps(100);
        _pay(bob, 1_000e18);
        vm.prank(bob);
        vm.expectRevert(CohortMarket.UnsupportedToken.selector);
        mkt.buyListing(id, b);
    }

    function test_listing_buyerCanUseUsdc() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        vm.prank(alice);
        uint256 id = mkt.listShares(_idB(cohort), b, 500e18, 1, 3 days);
        _fund(usdc, bob, 500e18);
        vm.startPrank(bob);
        mkt.buyListing(id, b);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(mkt)), 510e18, "price plus fee");
    }

    function test_coolingOffIsADeploymentSetting() public view {
        assertEq(mkt.COOLING_OFF(), 7 days);
    }
}

contract CohortMarketListingDustTest is MarketTestBase {
    function test_listing_purchaseCannotLeaveUnsellableDust() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        vm.prank(alice);
        uint256 id = mkt.listShares(_idB(cohort), b, 1_000e18, 0, 7 days);
        _fund(usdt, bob, 1_000e18);
        vm.startPrank(bob);
        vm.expectRevert(CohortMarket.SaleTooSmall.selector);
        mkt.buyListing(id, b - 1); // would leave 1 share behind
        mkt.buyListing(id, b); // the whole listing is fine
        vm.stopPrank();
    }
}
