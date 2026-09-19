// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LadderVault} from "../src/LadderVault.sol";
import {CohortMarket} from "../src/CohortMarket.sol";
import {MockStablecoin} from "./mocks/MockStablecoin.sol";
import {MarketTestBase} from "./utils/MarketTestBase.sol";

contract NoReceiverHook {}

contract CohortMarketTest is MarketTestBase {
    address internal carol = makeAddr("carol");

    function setUp() public override {
        super.setUp();
        vm.deal(carol, 10_000 ether);
    }

    // ================================================================ deployment

    function test_marketRefusesVaultThatExpectsAnotherAddress() public {
        // `vault` expects `mkt`; any new market lands elsewhere
        vm.expectRevert(CohortMarket.MarketMismatch.selector);
        new CohortMarket(vault, usdt, usdc, 7 days);
    }

    // ================================================================ happy path

    function test_fullSale() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1_000e18, address(0));

        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        assertEq(vault.balanceOf(address(mkt), _idB(cohort)), b, "shares in escrow");

        uint256 endsAt = block.timestamp + 7 days;
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CohortMarket.CoolingOffActive.selector, endsAt));
        mkt.collectShares(saleId, bob);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CohortMarket.CoolingOffActive.selector, endsAt));
        mkt.collectPayment(saleId, alice);

        vm.warp(endsAt);
        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        vm.prank(alice);
        mkt.collectPayment(saleId, alice);

        assertEq(vault.balanceOf(bob, _idB(cohort)), b);
        assertEq(usdt.balanceOf(alice), 1_000e18);
        assertEq(usdt.balanceOf(address(mkt)), 0);
        assertEq(vault.balanceOf(address(mkt), _idB(cohort)), 0);
    }

    function test_buyerCanResellThroughTheMarket() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1_000e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        vm.warp(block.timestamp + 7 days);
        vm.startPrank(bob);
        mkt.collectShares(saleId, bob);
        vault.setApprovalForAll(address(mkt), true);
        vm.stopPrank();

        uint256 offer2 = _offer(carol, _idB(cohort), b, 1_100e18, bob);
        vm.prank(bob);
        mkt.acceptOffer(offer2, b);
        assertEq(vault.balanceOf(address(mkt), _idB(cohort)), b);
    }

    // ================================================================ what can be offered

    function test_offer_rejectsRetirementAndFeeShares() public {
        usdt.mint(bob, 1e18);
        vm.startPrank(bob);
        usdt.approve(address(mkt), 1e18);
        vm.expectRevert(CohortMarket.NotEmergencyShare.selector);
        mkt.makeOffer(_idA(0), 1, 1e18, 0, address(0), 1 days);
        vm.expectRevert(CohortMarket.NotEmergencyShare.selector);
        mkt.makeOffer(2, 1, 1e18, 0, address(0), 1 days);
        vm.stopPrank();
    }

    function test_offer_rejectsBadTermsAndTokens() public {
        usdt.mint(bob, 10e18);
        vm.startPrank(bob);
        usdt.approve(address(mkt), 10e18);
        vm.expectRevert(CohortMarket.InvalidAmount.selector);
        mkt.makeOffer(_idB(0), 0, 1e18, 0, address(0), 1 days);
        vm.expectRevert(CohortMarket.InvalidDuration.selector);
        mkt.makeOffer(_idB(0), 1, 1e18, 0, address(0), 31 days);
        vm.expectRevert(CohortMarket.InvalidToken.selector);
        mkt.makeOffer(_idB(0), 1, 1e18, 2, address(0), 1 days);
        vm.stopPrank();
    }

    function test_offer_andAcceptClose7DaysBeforeMaturity() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 maturity = vault.maturityOf(cohort);
        vm.warp(maturity - 8 days);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));

        vm.warp(maturity - 7 days);
        usdt.mint(bob, 1e18);
        vm.startPrank(bob);
        usdt.approve(address(mkt), 1e18);
        vm.expectRevert(abi.encodeWithSelector(CohortMarket.CohortClosed.selector, maturity));
        mkt.makeOffer(_idB(cohort), b, 1e18, 0, address(0), 1 days);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CohortMarket.CohortClosed.selector, maturity));
        mkt.acceptOffer(offerId, b);
    }

    function test_feeOnTransferTokenRejected() public {
        MockStablecoin taxed = new MockStablecoin("TAX");
        taxed.setFeeBps(100);
        (LadderVault v, CohortMarket m) = _deployPair(usdt, taxed);
        vm.label(address(v), "vault2");
        taxed.mint(bob, 1e18);
        vm.startPrank(bob);
        taxed.approve(address(m), 1e18);
        vm.expectRevert(CohortMarket.UnsupportedToken.selector);
        m.makeOffer(_idB(0), 1, 1e18, 1, address(0), 1 days);
        vm.stopPrank();
    }

    // ================================================================ accepting

    function test_accept_restrictedToNamedSeller() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        _sellerWithShares(carol, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, alice);
        vm.prank(carol);
        vm.expectRevert(CohortMarket.NotOfferedToYou.selector);
        mkt.acceptOffer(offerId, b);
        vm.prank(alice);
        mkt.acceptOffer(offerId, b);
    }

    function test_accept_partialFillsArePricedProRata() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        _sellerWithShares(carol, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 900e18, address(0));

        vm.prank(alice);
        uint256 s1 = mkt.acceptOffer(offerId, b / 3);
        assertEq(mkt.getSale(s1).payment, (900e18 * (b / 3)) / b);

        uint256 rest = mkt.getOffer(offerId).remainingShares;
        uint256 restPay = mkt.getOffer(offerId).remainingPayment;
        vm.prank(carol);
        uint256 s2 = mkt.acceptOffer(offerId, rest);
        assertEq(mkt.getSale(s2).payment, restPay, "final fill takes exactly what is left, no dust");
        assertEq(mkt.getOffer(offerId).remainingPayment, 0);
    }

    function test_accept_rejectsExpiredOfferAndExcessShares() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b / 2, 1e18, address(0));
        vm.prank(alice);
        vm.expectRevert(CohortMarket.InvalidAmount.selector);
        mkt.acceptOffer(offerId, b);

        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        vm.expectRevert(CohortMarket.OfferExpired.selector);
        mkt.acceptOffer(offerId, b / 2);

        vm.prank(bob);
        mkt.withdrawOffer(offerId, bob);
        assertEq(usdt.balanceOf(bob), 1e18, "expired offer fully refundable");
    }

    function test_accept_retirementSharesCannotBeEscrowed() public {
        // Even with approval, the vault refuses to let the market move retirement shares.
        (uint256 cohort,) = _sellerWithShares(alice, 10 ether);
        vm.prank(address(mkt));
        vm.expectRevert(abi.encodeWithSelector(LadderVault.TransferRestricted.selector, _idA(cohort)));
        vault.safeTransferFrom(alice, address(mkt), _idA(cohort), 1, "");
    }

    // ================================================================ cancelling

    function test_cancel_onlySellerWithinCoolingOff() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1_000e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);

        vm.prank(bob);
        vm.expectRevert(CohortMarket.NotSeller.selector);
        mkt.cancelSale(saleId);

        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(alice);
        mkt.cancelSale(saleId);
        assertEq(vault.balanceOf(alice, _idB(cohort)), b, "shares back");
        assertEq(mkt.getOffer(offerId).refundable, 1_000e18);

        vm.prank(bob);
        mkt.withdrawOffer(offerId, bob);
        assertEq(usdt.balanceOf(bob), 1_000e18, "buyer made whole");

        vm.prank(alice);
        vm.expectRevert(CohortMarket.SaleClosed.selector);
        mkt.cancelSale(saleId);
    }

    function test_cancel_notAfterCoolingOff() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(CohortMarket.CoolingOffOver.selector);
        mkt.cancelSale(saleId);
    }

    function test_withdrawOffer_onlyBuyer_andClosesIt() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));
        vm.prank(alice);
        vm.expectRevert(CohortMarket.NotBuyer.selector);
        mkt.withdrawOffer(offerId, alice);
        vm.prank(bob);
        mkt.withdrawOffer(offerId, bob);
        vm.prank(alice);
        vm.expectRevert(CohortMarket.InvalidAmount.selector);
        mkt.acceptOffer(offerId, b);
    }

    // ================================================================ neither side can block the other

    function test_blacklistedSeller_buyerStillGetsShares_sellerRedirectsPayment() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1_000e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        usdt.setBlacklisted(alice, true);
        vm.warp(block.timestamp + 7 days);

        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        assertEq(vault.balanceOf(bob, _idB(cohort)), b);

        vm.prank(alice);
        vm.expectRevert();
        mkt.collectPayment(saleId, alice);
        vm.prank(alice);
        mkt.collectPayment(saleId, carol);
        assertEq(usdt.balanceOf(carol), 1_000e18);
    }

    function test_buyerThatCannotHoldShares_sellerStillPaid_buyerRedirects() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1_000e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        vm.warp(block.timestamp + 7 days);

        vm.prank(alice);
        mkt.collectPayment(saleId, alice);
        assertEq(usdt.balanceOf(alice), 1_000e18);

        address noHook = address(new NoReceiverHook());
        vm.prank(bob);
        vm.expectRevert();
        mkt.collectShares(saleId, noHook);
        vm.prank(bob);
        mkt.collectShares(saleId, carol);
        assertEq(vault.balanceOf(carol, _idB(cohort)), b);
    }

    function test_eip7702Buyer_receivesSharesWithoutHook() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        address delegated = makeAddr("delegated7702");
        vm.etch(delegated, abi.encodePacked(hex"ef0100", address(new NoReceiverHook())));
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        mkt.collectShares(saleId, delegated);
        assertEq(vault.balanceOf(delegated, _idB(cohort)), b);
    }

    // ================================================================ maturity while waiting

    function test_sharesMaturedBeforeCollection_buyerReceivesBnb() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 maturity = vault.maturityOf(cohort);
        vm.warp(maturity - 8 days);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);

        vm.warp(maturity + 1 days);
        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        CohortMarket.Sale memory s = mkt.getSale(saleId);
        assertTrue(s.claimOpened);

        uint256 before = carol.balance;
        vm.prank(bob);
        mkt.withdrawSaleClaim(saleId, carol);
        assertApproxEqAbs(carol.balance - before, 3 ether, 2, "the shares' BNB reaches the buyer");

        vm.prank(alice);
        mkt.collectPayment(saleId, alice);
        assertEq(usdt.balanceOf(alice), 1e18);
    }

    function test_saleClaim_cannotBeHijackedThroughVaultWithdraw() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 maturity = vault.maturityOf(cohort);
        vm.warp(maturity - 8 days);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);
        vm.warp(maturity + 1 days);
        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        uint256 claimId = mkt.getSale(saleId).claimId;

        // Anyone may trigger vault.withdraw, but it pays the market, which cannot receive BNB: nothing moves.
        vm.prank(carol);
        vm.expectRevert(LadderVault.WithdrawFailed.selector);
        vault.withdraw(claimId);
        vm.prank(carol);
        vm.expectRevert(CohortMarket.NotBuyer.selector);
        mkt.withdrawSaleClaim(saleId, carol);
    }

    function test_accept_rejectsDustSales() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));
        vm.prank(alice);
        vm.expectRevert(CohortMarket.SaleTooSmall.selector);
        mkt.acceptOffer(offerId, 1);
    }

    /// Regression (market fuzzer): shares that matured before collection but are worth nothing could never be
    /// collected. Collection now closes the sale instead of reverting forever.
    function test_worthlessSharesAtMaturity_saleCanStillClose() public {
        (uint256 cohort, uint256 b) = _sellerWithShares(alice, 10 ether);
        uint256 maturity = vault.maturityOf(cohort);
        vm.warp(maturity - 8 days);
        uint256 offerId = _offer(bob, _idB(cohort), b, 1e18, address(0));
        vm.prank(alice);
        uint256 saleId = mkt.acceptOffer(offerId, b);

        // Every wei of the pool vanishes (e.g. a catastrophic staking loss): the escrowed shares are now worthless.
        vault.flush();
        uint256 staked = _credit(v1).getPooledBNB(address(vault));
        uint256 pool = _credit(v1).totalPooledBNB();
        hub.simulateLoss(v1, (pool * (staked - 1)) / staked);
        if (vault.previewRedeem(b) != 0) {
            // make sure the scenario really is worthless
            hub.simulateLoss(v1, _credit(v1).totalPooledBNB() - 1);
        }
        vm.deal(address(vault), 0);
        assertEq(vault.previewRedeem(b), 0);

        vm.warp(maturity + 1);
        vm.prank(bob);
        mkt.collectShares(saleId, bob);
        assertTrue(mkt.getSale(saleId).sharesCollected);
        assertFalse(mkt.getSale(saleId).claimOpened);
    }

    // ================================================================ unsolicited tokens

    function test_rejectsSharesItDidNotRequest() public {
        vm.prank(address(vault));
        vm.expectRevert(CohortMarket.UnexpectedTokens.selector);
        mkt.onERC1155Received(alice, alice, 1, 1, "");
        vm.expectRevert(CohortMarket.UnexpectedTokens.selector);
        mkt.onERC1155BatchReceived(alice, alice, new uint256[](0), new uint256[](0), "");
    }
}
