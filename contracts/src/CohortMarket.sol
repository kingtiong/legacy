// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LadderVault} from "./LadderVault.sol";

/// @title Legacy Ladder emergency-share market
/// @notice The only way to sell emergency-bucket shares before they mature. A buyer escrows stablecoin in an offer;
///         a holder accepts, which escrows their shares and starts a seven-day cooling-off during which only the
///         seller may cancel. After it, each side collects independently.
/// @dev    Security rules (see docs/THREAT_MODEL.md):
///         - No owner, no admin, no fees, no upgrade.
///         - Neither party can block the other: shares and payment are collected separately, to an address the
///           collector chooses, so a blacklisted or non-receiving address only ever affects its own side.
///         - Only emergency-bucket shares, and only tokens this contract pulled itself, are ever held. The vault
///           independently refuses to let this contract touch retirement shares.
contract CohortMarket is ERC1155Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;

    LadderVault public immutable VAULT;
    IERC20 public immutable PAYMENT_TOKEN_0;
    IERC20 public immutable PAYMENT_TOKEN_1;

    uint256 public constant COOLING_OFF = 7 days;
    uint256 public constant MAX_OFFER_DURATION = 30 days;
    /// @notice A sale must be worth at least this much BNB. Dust sales could otherwise mature into claims too small
    ///         for the vault to pay, and would be free spam.
    uint256 public constant MIN_SALE_VALUE = 1e12;

    struct Offer {
        address buyer;
        uint64 expiresAt;
        address seller; // address(0): any holder may accept
        uint8 token;
        uint256 shareId;
        uint256 remainingShares;
        uint256 remainingPayment;
        uint256 refundable; // payment returned by cancelled sales
    }

    struct Sale {
        uint256 offerId;
        address seller;
        uint64 acceptedAt;
        bool cancelled;
        bool sharesCollected;
        bool paymentCollected;
        bool claimOpened;
        uint256 shares;
        uint256 payment;
        uint256 claimId;
    }

    Offer[] internal _offers;
    Sale[] internal _sales;

    event OfferMade(
        uint256 indexed offerId,
        address indexed buyer,
        address indexed seller,
        uint256 shareId,
        uint256 shares,
        uint256 payment,
        uint8 token,
        uint64 expiresAt
    );
    event OfferWithdrawn(uint256 indexed offerId, address to, uint256 amount);
    event OfferAccepted(
        uint256 indexed offerId,
        uint256 indexed saleId,
        address indexed seller,
        uint256 shares,
        uint256 payment,
        uint64 coolingOffEnds
    );
    event SaleCancelled(uint256 indexed saleId);
    event SharesCollected(uint256 indexed saleId, address to, uint256 shares);
    event SaleClaimOpened(uint256 indexed saleId, uint256 claimId);
    event WorthlessSharesAbandoned(uint256 indexed saleId, uint256 shares);
    event PaymentCollected(uint256 indexed saleId, address to, uint256 amount);

    error ZeroAddress();
    error InvalidAmount();
    error InvalidDuration();
    error InvalidToken();
    error UnsupportedToken();
    error NotEmergencyShare();
    error CohortClosed(uint256 maturesAt);
    error UnknownOffer();
    error UnknownSale();
    error OfferExpired();
    error NotOfferedToYou();
    error NotBuyer();
    error NotSeller();
    error SaleClosed();
    error CoolingOffActive(uint256 endsAt);
    error CoolingOffOver();
    error NoSaleClaim();
    error UnexpectedTokens();
    error MarketMismatch();
    error SaleTooSmall();

    constructor(LadderVault vault, IERC20 token0, IERC20 token1) {
        if (address(token0) == address(0) || address(token1) == address(0) || token0 == token1) {
            revert InvalidToken();
        }
        // The vault fixes its market address at deployment; refuse to exist anywhere else.
        if (vault.MARKET() != address(this)) revert MarketMismatch();
        VAULT = vault;
        PAYMENT_TOKEN_0 = token0;
        PAYMENT_TOKEN_1 = token1;
    }

    // ---------------------------------------------------------------- buyers

    /// @notice Escrow `payment` of a stablecoin for `shares` emergency shares of one cohort.
    /// @param seller Restrict the offer to one holder, or address(0) for anyone.
    function makeOffer(
        uint256 shareId,
        uint256 shares,
        uint256 payment,
        uint8 token,
        address seller,
        uint64 duration
    ) external nonReentrant returns (uint256 offerId) {
        if (shareId & 3 != 1) revert NotEmergencyShare();
        if (shares == 0 || payment == 0) revert InvalidAmount();
        if (duration == 0 || duration > MAX_OFFER_DURATION) revert InvalidDuration();
        IERC20 t = _token(token);
        uint256 maturesAt = VAULT.maturityOf(shareId >> 2);
        if (block.timestamp + COOLING_OFF >= maturesAt) revert CohortClosed(maturesAt);

        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), payment);
        if (t.balanceOf(address(this)) - before != payment) revert UnsupportedToken();

        offerId = _offers.length;
        uint64 expiresAt = uint64(block.timestamp) + duration;
        _offers.push(
            Offer({
                buyer: msg.sender,
                expiresAt: expiresAt,
                seller: seller,
                token: token,
                shareId: shareId,
                remainingShares: shares,
                remainingPayment: payment,
                refundable: 0
            })
        );
        emit OfferMade(offerId, msg.sender, seller, shareId, shares, payment, token, expiresAt);
    }

    /// @notice Close an offer and take back everything unspent, including refunds from cancelled sales.
    function withdrawOffer(uint256 offerId, address to) external nonReentrant {
        Offer storage o = _offer(offerId);
        if (msg.sender != o.buyer) revert NotBuyer();
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = o.remainingPayment + o.refundable;
        if (amount == 0) revert InvalidAmount();
        o.remainingShares = 0;
        o.remainingPayment = 0;
        o.refundable = 0;
        emit OfferWithdrawn(offerId, to, amount);
        _token(o.token).safeTransfer(to, amount);
    }

    /// @notice Take the shares once the cooling-off is over. If the cohort matured in the meantime, the shares can
    ///         no longer be transferred, so they are redeemed into a vault claim instead; see `withdrawSaleClaim`.
    function collectShares(uint256 saleId, address to) external nonReentrant {
        Sale storage s = _sale(saleId);
        Offer storage o = _offers[s.offerId];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (to == address(0)) revert ZeroAddress();
        if (s.cancelled || s.sharesCollected) revert SaleClosed();
        uint256 endsAt = s.acceptedAt + COOLING_OFF;
        if (block.timestamp < endsAt) revert CoolingOffActive(endsAt);

        s.sharesCollected = true;
        if (block.timestamp < VAULT.maturityOf(o.shareId >> 2)) {
            emit SharesCollected(saleId, to, s.shares);
            VAULT.safeTransferFrom(address(this), to, o.shareId, s.shares, "");
        } else if (VAULT.previewRedeem(s.shares) == 0) {
            // Worth less than one wei (only possible after a loss): no claim can be opened, so close the sale
            // rather than leave a collection that can never succeed.
            emit WorthlessSharesAbandoned(saleId, s.shares);
        } else {
            s.claimOpened = true;
            s.claimId = VAULT.requestClaim(o.shareId, s.shares);
            emit SaleClaimOpened(saleId, s.claimId);
        }
    }

    /// @notice Withdraw the BNB of a sale whose shares matured before they were collected.
    function withdrawSaleClaim(uint256 saleId, address to) external nonReentrant {
        Sale storage s = _sale(saleId);
        if (msg.sender != _offers[s.offerId].buyer) revert NotBuyer();
        if (!s.claimOpened) revert NoSaleClaim();
        VAULT.withdrawTo(s.claimId, to);
    }

    // ---------------------------------------------------------------- sellers

    /// @notice Sell `shares` into an offer. Escrows them and starts the cooling-off. Requires
    ///         `setApprovalForAll(market, true)` on the vault.
    function acceptOffer(uint256 offerId, uint256 shares) external nonReentrant returns (uint256 saleId) {
        Offer storage o = _offer(offerId);
        if (block.timestamp >= o.expiresAt) revert OfferExpired();
        if (o.seller != address(0) && o.seller != msg.sender) revert NotOfferedToYou();
        if (shares == 0 || shares > o.remainingShares) revert InvalidAmount();
        if (VAULT.previewRedeem(shares) < MIN_SALE_VALUE) revert SaleTooSmall();
        uint256 maturesAt = VAULT.maturityOf(o.shareId >> 2);
        if (block.timestamp + COOLING_OFF >= maturesAt) revert CohortClosed(maturesAt);

        uint256 payment = shares == o.remainingShares
            ? o.remainingPayment
            : Math.mulDiv(o.remainingPayment, shares, o.remainingShares);
        if (payment == 0) revert InvalidAmount();
        o.remainingShares -= shares;
        o.remainingPayment -= payment;

        saleId = _sales.length;
        _sales.push(
            Sale({
                offerId: offerId,
                seller: msg.sender,
                acceptedAt: uint64(block.timestamp),
                cancelled: false,
                sharesCollected: false,
                paymentCollected: false,
                claimOpened: false,
                shares: shares,
                payment: payment,
                claimId: 0
            })
        );
        emit OfferAccepted(
            offerId, saleId, msg.sender, shares, payment, uint64(block.timestamp + COOLING_OFF)
        );

        VAULT.safeTransferFrom(msg.sender, address(this), o.shareId, shares, "");
    }

    /// @notice Change your mind within the cooling-off: your shares come back, and the payment becomes refundable to
    ///         the buyer.
    function cancelSale(uint256 saleId) external nonReentrant {
        Sale storage s = _sale(saleId);
        if (msg.sender != s.seller) revert NotSeller();
        if (s.cancelled) revert SaleClosed();
        if (block.timestamp >= s.acceptedAt + COOLING_OFF) revert CoolingOffOver();

        s.cancelled = true;
        Offer storage o = _offers[s.offerId];
        o.refundable += s.payment;
        emit SaleCancelled(saleId);

        // Acceptance requires the cooling-off to end before maturity, so this transfer is still allowed.
        VAULT.safeTransferFrom(address(this), s.seller, o.shareId, s.shares, "");
    }

    /// @notice Take the payment once the cooling-off is over.
    function collectPayment(uint256 saleId, address to) external nonReentrant {
        Sale storage s = _sale(saleId);
        if (msg.sender != s.seller) revert NotSeller();
        if (to == address(0)) revert ZeroAddress();
        if (s.cancelled || s.paymentCollected) revert SaleClosed();
        uint256 endsAt = s.acceptedAt + COOLING_OFF;
        if (block.timestamp < endsAt) revert CoolingOffActive(endsAt);

        s.paymentCollected = true;
        emit PaymentCollected(saleId, to, s.payment);
        _token(_offers[s.offerId].token).safeTransfer(to, s.payment);
    }

    // ---------------------------------------------------------------- views

    function offerCount() external view returns (uint256) {
        return _offers.length;
    }

    function saleCount() external view returns (uint256) {
        return _sales.length;
    }

    function getOffer(uint256 offerId) external view returns (Offer memory) {
        return _offers[offerId];
    }

    function getSale(uint256 saleId) external view returns (Sale memory) {
        return _sales[saleId];
    }

    // ---------------------------------------------------------------- receiving shares

    /// @dev Only accept shares the market itself pulled from the vault.
    function onERC1155Received(address operator, address, uint256, uint256, bytes memory)
        public
        view
        override
        returns (bytes4)
    {
        if (msg.sender != address(VAULT) || operator != address(this)) revert UnexpectedTokens();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes memory)
        public
        pure
        override
        returns (bytes4)
    {
        revert UnexpectedTokens();
    }

    // ---------------------------------------------------------------- internals

    function _token(uint8 index) internal view returns (IERC20) {
        if (index == 0) return PAYMENT_TOKEN_0;
        if (index == 1) return PAYMENT_TOKEN_1;
        revert InvalidToken();
    }

    function _offer(uint256 offerId) internal view returns (Offer storage) {
        if (offerId >= _offers.length) revert UnknownOffer();
        return _offers[offerId];
    }

    function _sale(uint256 saleId) internal view returns (Sale storage) {
        if (saleId >= _sales.length) revert UnknownSale();
        return _sales[saleId];
    }
}
