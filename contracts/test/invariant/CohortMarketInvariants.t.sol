// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {LadderVault} from "../../src/LadderVault.sol";
import {CohortMarket} from "../../src/CohortMarket.sol";
import {MockStablecoin} from "../mocks/MockStablecoin.sol";
import {MarketTestBase} from "../utils/MarketTestBase.sol";

contract MarketHandler is Test {
    LadderVault internal immutable vault;
    CohortMarket internal immutable mkt;
    MockStablecoin[2] internal tokens;
    address[] public actors;
    address internal immutable refuge = makeAddr("refuge"); // never blacklisted: where a blocked party redirects

    uint256[] public cohorts;
    mapping(uint256 => bool) internal seenCohort;

    // Broken promises. Every one must stay zero.
    uint256 public cancelInCoolingOffFailed;
    uint256 public collectSharesFailed;
    uint256 public collectPaymentFailed;
    uint256 public refundFailed;
    uint256 public cancelListingFailed;
    uint256 public listingsBought;
    bytes4 public lastUnexpected;

    uint256 public accepted;
    uint256 public cancelled;
    uint256 public sharesCollected;
    uint256 public paymentsCollected;
    uint256 public claimRoutes;

    constructor(LadderVault vault_, CohortMarket mkt_, MockStablecoin t0, MockStablecoin t1) {
        vault = vault_;
        mkt = mkt_;
        tokens = [t0, t1];
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string.concat("trader", vm.toString(i)));
            actors.push(a);
            vm.deal(a, 1_000 ether);
            vm.prank(a);
            vault.setApprovalForAll(address(mkt), true);
        }
        for (uint256 i; i < actors.length; ++i) {
            _depositFor(actors[i], 20 ether);
        }
    }

    // ---------------------------------------------------------------- actions

    function deposit(uint256 actorSeed, uint256 amount) external {
        _depositFor(actors[actorSeed % actors.length], bound(amount, 0.1 ether, 30 ether));
    }

    function makeOffer(
        uint256 buyerSeed,
        uint256 sellerSeed,
        uint256 cohortSeed,
        uint256 shares,
        uint256 payment,
        uint256 tokenSeed,
        uint256 duration
    ) external {
        address buyer = actors[buyerSeed % actors.length];
        address seller = sellerSeed % 3 == 0 ? address(0) : actors[sellerSeed % actors.length];
        uint256 id = (cohorts[cohortSeed % cohorts.length] << 2) | 1;
        uint8 t = uint8(tokenSeed % 2);
        if (tokens[t].blacklisted(buyer)) return; // cannot fund an offer from a blacklisted address
        shares = bound(shares, 1e18, 1e22); // 0.001 to 10 BNB of shares
        payment = bound(payment, 1e6, 1e24);
        uint256 escrow = payment + payment * mkt.TRADE_FEE_BPS() / 10_000;
        tokens[t].mint(buyer, escrow);
        vm.startPrank(buyer);
        tokens[t].approve(address(mkt), escrow);
        try mkt.makeOffer(id, shares, payment, t, seller, uint64(bound(duration, 1, 30 days))) {} catch {}
        vm.stopPrank();
    }

    function acceptOffer(uint256 sellerSeed, uint256 offerSeed, uint256 shares) external {
        uint256 n = mkt.offerCount();
        if (n == 0) return;
        CohortMarket.Offer memory o = mkt.getOffer(offerSeed % n);
        address seller = o.seller;
        if (seller == address(0)) {
            for (uint256 i; i < actors.length; ++i) {
                address candidate = actors[(sellerSeed % actors.length + i) % actors.length];
                if (vault.balanceOf(candidate, o.shareId) != 0) {
                    seller = candidate;
                    break;
                }
            }
        }
        if (seller == address(0)) return;
        uint256 held = vault.balanceOf(seller, o.shareId);
        uint256 max = held < o.remainingShares ? held : o.remainingShares;
        if (max == 0) return;
        vm.prank(seller);
        try mkt.acceptOffer(offerSeed % n, bound(shares, max / 4 + 1, max)) {
            ++accepted;
        } catch {}
    }

    // ---------------------------------------------------------------- listings

    function listShares(
        uint256 sellerSeed,
        uint256 cohortSeed,
        uint256 fraction,
        uint256 price,
        uint256 tokenSeed,
        uint256 duration
    ) external {
        address seller = actors[sellerSeed % actors.length];
        uint256 id = (cohorts[cohortSeed % cohorts.length] << 2) | 1;
        uint256 held = vault.balanceOf(seller, id);
        if (held == 0) return;
        uint256 shares = bound(fraction, held / 10 + 1, held);
        vm.prank(seller);
        try mkt.listShares(
            id, shares, bound(price, 1e6, 1e24), uint8(tokenSeed % 2), uint64(bound(duration, 1, 30 days))
        ) {}
            catch {}
    }

    function buyListing(uint256 buyerSeed, uint256 listingSeed, uint256 fraction) external {
        uint256 n = mkt.listingCount();
        if (n == 0) return;
        uint256 listingId = listingSeed % n;
        CohortMarket.Listing memory l = mkt.getListing(listingId);
        if (l.remainingShares == 0) return;
        address buyer = actors[buyerSeed % actors.length];
        MockStablecoin t = tokens[l.token];
        if (t.blacklisted(buyer)) return;
        uint256 shares = bound(fraction, l.remainingShares / 4 + 1, l.remainingShares);
        if (vault.previewRedeem(l.remainingShares - shares) < mkt.MIN_SALE_VALUE()) {
            shares = l.remainingShares;
        }
        t.mint(buyer, l.remainingPrice + l.remainingPrice * mkt.TRADE_FEE_BPS() / 10_000);
        vm.startPrank(buyer);
        t.approve(address(mkt), l.remainingPrice);
        try mkt.buyListing(listingId, shares) {
            ++listingsBought;
        } catch {}
        vm.stopPrank();
    }

    function cancelListing(uint256 listingSeed, bool toRefuge) external {
        uint256 n = mkt.listingCount();
        if (n == 0) return;
        uint256 listingId = listingSeed % n;
        CohortMarket.Listing memory l = mkt.getListing(listingId);
        if (l.remainingShares == 0) return;
        vm.prank(l.seller);
        try mkt.cancelListing(listingId, toRefuge ? refuge : l.seller) {}
        catch (bytes memory reason) {
            ++cancelListingFailed; // a seller must always be able to take unsold shares back
            lastUnexpected = bytes4(reason);
        }
    }

    function cancelSale(uint256 saleSeed) external {
        uint256 n = mkt.saleCount();
        if (n == 0) return;
        uint256 saleId = saleSeed % n;
        CohortMarket.Sale memory s = mkt.getSale(saleId);
        if (s.cancelled || block.timestamp >= s.acceptedAt + mkt.COOLING_OFF()) return;
        MockStablecoin t = tokens[mkt.getOffer(s.offerId).token];
        if (t.blacklisted(s.seller)) return; // cannot pay the cancellation fee from a blacklisted address
        uint256 penalty = s.payment * mkt.CANCEL_FEE_BPS() / 10_000;
        t.mint(s.seller, penalty);
        vm.prank(s.seller);
        t.approve(address(mkt), penalty);
        vm.prank(s.seller);
        try mkt.cancelSale(saleId) {
            ++cancelled;
        } catch (bytes memory reason) {
            ++cancelInCoolingOffFailed;
            lastUnexpected = bytes4(reason);
        }
    }

    function collectShares(uint256 saleSeed, bool toRefuge) external {
        uint256 n = mkt.saleCount();
        if (n == 0) return;
        uint256 saleId = saleSeed % n;
        CohortMarket.Sale memory s = mkt.getSale(saleId);
        if (s.cancelled || s.sharesCollected || block.timestamp < s.acceptedAt + mkt.COOLING_OFF()) return;
        address buyer = mkt.getOffer(s.offerId).buyer;
        vm.prank(buyer);
        try mkt.collectShares(saleId, toRefuge ? refuge : buyer) {
            ++sharesCollected;
            if (mkt.getSale(saleId).claimOpened) ++claimRoutes;
        } catch (bytes memory reason) {
            ++collectSharesFailed;
            lastUnexpected = bytes4(reason);
        }
    }

    function withdrawSaleClaim(uint256 saleSeed) external {
        uint256 n = mkt.saleCount();
        if (n == 0) return;
        CohortMarket.Sale memory s = mkt.getSale(saleSeed % n);
        if (!s.claimOpened || vault.getClaim(s.claimId).withdrawn) return;
        vm.prank(mkt.getOffer(s.offerId).buyer);
        try mkt.withdrawSaleClaim(saleSeed % n, refuge) {} catch {}
    }

    function collectPayment(uint256 saleSeed) external {
        uint256 n = mkt.saleCount();
        if (n == 0) return;
        uint256 saleId = saleSeed % n;
        CohortMarket.Sale memory s = mkt.getSale(saleId);
        if (s.cancelled || s.paymentCollected || block.timestamp < s.acceptedAt + mkt.COOLING_OFF()) return;
        MockStablecoin t = tokens[mkt.getOffer(s.offerId).token];
        // A blacklisted seller redirects; either way collection must succeed.
        address to = t.blacklisted(s.seller) ? refuge : s.seller;
        vm.prank(s.seller);
        try mkt.collectPayment(saleId, to) {
            ++paymentsCollected;
        } catch (bytes memory reason) {
            ++collectPaymentFailed;
            lastUnexpected = bytes4(reason);
        }
    }

    function withdrawOffer(uint256 offerSeed) external {
        uint256 n = mkt.offerCount();
        if (n == 0) return;
        CohortMarket.Offer memory o = mkt.getOffer(offerSeed % n);
        if (o.remainingPayment + o.refundable == 0) return;
        // A blacklisted buyer redirects; either way the refund must succeed.
        address to = tokens[o.token].blacklisted(o.buyer) ? refuge : o.buyer;
        vm.prank(o.buyer);
        try mkt.withdrawOffer(offerSeed % n, to) {}
        catch (bytes memory reason) {
            ++refundFailed;
            lastUnexpected = bytes4(reason);
        }
    }

    function toggleBlacklist(uint256 actorSeed, uint256 tokenSeed) external {
        address a = actors[actorSeed % actors.length];
        MockStablecoin t = tokens[tokenSeed % 2];
        t.setBlacklisted(a, !t.blacklisted(a));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 20 days));
    }

    function jumpAroundMaturity(uint256 cohortSeed, uint256 offsetSeed) external {
        uint256 maturity = vault.maturityOf(cohorts[cohortSeed % cohorts.length]);
        uint256 target = maturity - 9 days + bound(offsetSeed, 0, 11 days);
        if (target > block.timestamp) vm.warp(target);
    }

    function acceptAgain(uint256 a, uint256 o, uint256 s) external {
        this.acceptOffer(a, o, s);
    }

    // ---------------------------------------------------------------- final drain

    function drain() external returns (bool) {
        for (uint256 i; i < 2; ++i) {
            for (uint256 a; a < actors.length; ++a) {
                tokens[i].setBlacklisted(actors[a], false);
            }
        }
        vm.warp(block.timestamp + 8 days);
        for (uint256 saleId; saleId < mkt.saleCount(); ++saleId) {
            CohortMarket.Sale memory s = mkt.getSale(saleId);
            if (s.cancelled) continue;
            address buyer = mkt.getOffer(s.offerId).buyer;
            if (!s.sharesCollected) {
                vm.prank(buyer);
                mkt.collectShares(saleId, buyer);
            }
            if (mkt.getSale(saleId).claimOpened && !vault.getClaim(mkt.getSale(saleId).claimId).withdrawn) {
                vm.warp(block.timestamp + 8 days);
                vm.prank(buyer);
                mkt.withdrawSaleClaim(saleId, buyer);
            }
            if (!s.paymentCollected) {
                vm.prank(s.seller);
                mkt.collectPayment(saleId, s.seller);
            } else if (!s.feeSettled && s.fee != 0) {
                mkt.settleFee(saleId);
            }
        }
        for (uint256 listingId; listingId < mkt.listingCount(); ++listingId) {
            CohortMarket.Listing memory l = mkt.getListing(listingId);
            if (l.remainingShares != 0) {
                vm.prank(l.seller);
                mkt.cancelListing(listingId, l.seller);
                l = mkt.getListing(listingId);
            }
            if (l.claimOpened && !vault.getClaim(l.claimId).withdrawn) {
                vm.warp(block.timestamp + 8 days);
                vm.prank(l.seller);
                mkt.withdrawListingClaim(listingId, l.seller);
            }
        }
        for (uint256 offerId; offerId < mkt.offerCount(); ++offerId) {
            CohortMarket.Offer memory o = mkt.getOffer(offerId);
            if (o.remainingPayment + o.refundable == 0) continue;
            vm.prank(o.buyer);
            mkt.withdrawOffer(offerId, o.buyer);
        }
        return true;
    }

    function holders() external view returns (address[] memory list) {
        list = new address[](actors.length + 2);
        for (uint256 i; i < actors.length; ++i) {
            list[i] = actors[i];
        }
        list[actors.length] = address(mkt);
        list[actors.length + 1] = refuge;
    }

    function cohortList() external view returns (uint256[] memory) {
        return cohorts;
    }

    function cohortCount() external view returns (uint256) {
        return cohorts.length;
    }

    function _depositFor(address a, uint256 amount) internal {
        vm.deal(a, a.balance + amount);
        vm.prank(a);
        try vault.deposit{value: amount}(a, 7_000) returns (uint256 cohort, uint256, uint256) {
            if (!seenCohort[cohort]) {
                seenCohort[cohort] = true;
                cohorts.push(cohort);
            }
        } catch {}
    }
}

contract CohortMarketInvariants is MarketTestBase {
    MarketHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new MarketHandler(vault, mkt, usdt, usdc);
        targetContract(address(handler));
        bytes4[] memory skip = new bytes4[](1);
        skip[0] = MarketHandler.drain.selector;
        excludeSelector(FuzzSelector({addr: address(handler), selectors: skip}));
    }

    /// The market's stablecoin balance is exactly what open offers, refunds and uncollected sales hold.
    function invariant_everyTokenAccountedFor() public view {
        uint256[2] memory owed;
        for (uint256 i; i < mkt.offerCount(); ++i) {
            CohortMarket.Offer memory o = mkt.getOffer(i);
            owed[o.token] += o.remainingPayment + o.remainingFee + o.refundable;
        }
        for (uint256 i; i < mkt.saleCount(); ++i) {
            CohortMarket.Sale memory s = mkt.getSale(i);
            if (s.cancelled) continue;
            uint8 token = mkt.getOffer(s.offerId).token;
            if (!s.paymentCollected) owed[token] += s.payment;
            if (!s.feeSettled) owed[token] += s.fee;
        }
        assertEq(usdt.balanceOf(address(mkt)), owed[0], "USDT");
        assertEq(usdc.balanceOf(address(mkt)), owed[1], "USDC");
    }

    /// Escrowed shares are exactly those of accepted, uncancelled, uncollected sales; never retirement shares.
    function invariant_everyEscrowedShareAccountedFor() public view {
        for (uint256 c; c < handler.cohortCount(); ++c) {
            uint256 cohort = handler.cohorts(c);
            uint256 idB = (cohort << 2) | 1;
            uint256 escrowed;
            for (uint256 i; i < mkt.saleCount(); ++i) {
                CohortMarket.Sale memory s = mkt.getSale(i);
                if (!s.cancelled && !s.sharesCollected && mkt.getOffer(s.offerId).shareId == idB) {
                    escrowed += s.shares;
                }
            }
            for (uint256 i; i < mkt.listingCount(); ++i) {
                CohortMarket.Listing memory l = mkt.getListing(i);
                if (l.shareId == idB) escrowed += l.remainingShares;
            }
            // Exactly what open listings and sales hold, plus at most worthless shares abandoned after maturity.
            uint256 held = vault.balanceOf(address(mkt), idB);
            assertGe(held, escrowed, "escrow short");
            assertEq(vault.previewRedeem(held - escrowed), 0, "unaccounted shares of any value");
            assertEq(vault.balanceOf(address(mkt), cohort << 2), 0, "never holds retirement shares");
        }
    }

    /// Votes follow shares through offers, escrow, cancellations, collections and matured claim routes.
    function invariant_votesMatchShares() public {
        _assertVotesMatchShares(vault, handler.holders(), handler.cohortList());
    }

    function invariant_sellerCanAlwaysTakeBackUnsoldListing() public view {
        assertEq(handler.cancelListingFailed(), 0, vm.toString(abi.encodePacked(handler.lastUnexpected())));
    }

    /// A seller who holds the cancellation fee can always undo a sale within the cooling-off. One who cannot pay it
    /// simply does not cancel, and the sale completes: that case is covered in test/MarketFees.t.sol.
    function invariant_sellerWhoPaysCanAlwaysCancelInCoolingOff() public view {
        assertEq(
            handler.cancelInCoolingOffFailed(), 0, vm.toString(abi.encodePacked(handler.lastUnexpected()))
        );
    }

    function invariant_buyerCanAlwaysCollectShares() public view {
        assertEq(handler.collectSharesFailed(), 0, vm.toString(abi.encodePacked(handler.lastUnexpected())));
    }

    function invariant_sellerCanAlwaysCollectPayment() public view {
        assertEq(handler.collectPaymentFailed(), 0, vm.toString(abi.encodePacked(handler.lastUnexpected())));
    }

    function invariant_buyerCanAlwaysTakeBackUnspentMoney() public view {
        assertEq(handler.refundFailed(), 0, vm.toString(abi.encodePacked(handler.lastUnexpected())));
    }

    /// After every run everyone collects everything: the market must be left holding nothing.
    function afterInvariant() external {
        assertTrue(handler.drain());
        assertEq(usdt.balanceOf(address(mkt)), 0, "USDT left behind");
        assertEq(usdc.balanceOf(address(mkt)), 0, "USDC left behind");
        for (uint256 c; c < handler.cohortCount(); ++c) {
            uint256 left = vault.balanceOf(address(mkt), (handler.cohorts(c) << 2) | 1);
            assertEq(vault.previewRedeem(left), 0, "shares of any value left behind");
        }
        // Path-coverage notes are a local diagnostic: opt in with COVERAGE_LOG=true.
        if (!vm.envOr("COVERAGE_LOG", false)) return;
        vm.createDir("cache/coverage", true);
        vm.writeLine(
            "cache/coverage/market.log",
            string.concat(
                "accepted=",
                vm.toString(handler.accepted()),
                " cancelled=",
                vm.toString(handler.cancelled()),
                " sharesCollected=",
                vm.toString(handler.sharesCollected()),
                " claimRoutes=",
                vm.toString(handler.claimRoutes()),
                " payments=",
                vm.toString(handler.paymentsCollected())
            )
        );
    }
}
