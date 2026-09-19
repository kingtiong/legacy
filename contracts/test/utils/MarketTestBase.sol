// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {LadderVault} from "../../src/LadderVault.sol";
import {CohortMarket} from "../../src/CohortMarket.sol";
import {MockStablecoin} from "../mocks/MockStablecoin.sol";
import {VaultTestBase} from "./VaultTestBase.sol";

/// @dev Deploys the vault and market the way the deploy script must: predict the market's address, give it to the
///      vault, then deploy the market, which checks it landed there.
abstract contract MarketTestBase is VaultTestBase {
    CohortMarket internal mkt;
    MockStablecoin internal usdt;
    MockStablecoin internal usdc;

    function setUp() public virtual override {
        super.setUp();
        usdt = new MockStablecoin("USDT");
        usdc = new MockStablecoin("USDC");
        (vault, mkt) = _deployPair(usdt, usdc);
        market = address(mkt);
    }

    function _deployPair(MockStablecoin t0, MockStablecoin t1)
        internal
        returns (LadderVault v, CohortMarket m)
    {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        address[] memory vals = new address[](3);
        vals[0] = v1;
        vals[1] = v2;
        vals[2] = v3;
        v = new LadderVault(
            LadderVault.Config({
                market: predicted,
                feeRecipient: feeRecipient,
                curator: curator,
                validators: vals,
                minDeposit: MIN_DEPOSIT,
                maxDeposit: MAX_DEPOSIT,
                capInitial: CAP_INITIAL,
                capGrowthPerEpoch: CAP_GROWTH,
                capRemovedAtEpoch: CAP_REMOVED_AT,
                epoch: 2_629_746,
                lockEpochs: 120
            })
        );
        m = new CohortMarket(v, t0, t1, 7 days);
        assertEq(address(m), predicted, "market deployed at the address the vault expects");
    }

    /// @dev `seller` deposits and approves the market; returns their emergency shares.
    function _sellerWithShares(address seller, uint256 bnb)
        internal
        returns (uint256 cohort, uint256 sharesB)
    {
        vm.startPrank(seller);
        (cohort,, sharesB) = vault.deposit{value: bnb}(seller, 7_000);
        vault.setApprovalForAll(address(mkt), true);
        vm.stopPrank();
    }

    function _offer(address buyer, uint256 shareId, uint256 shares, uint256 payment, address seller)
        internal
        returns (uint256 offerId)
    {
        usdt.mint(buyer, payment);
        vm.startPrank(buyer);
        usdt.approve(address(mkt), payment);
        offerId = mkt.makeOffer(shareId, shares, payment, 0, seller, 30 days);
        vm.stopPrank();
    }
}
