// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IStakeHub, IStakeCredit} from "./interfaces/IStakeHub.sol";

/// @title Legacy Ladder vault (BNB Smart Chain)
/// @notice Time-locked BNB savings. Each deposit mints shares in its monthly cohort, split into a retirement
///         bucket that can never be transferred and an emergency bucket that only the market can move. All BNB
///         is staked with BNB Chain validators through StakeHub. A cohort's shares can be redeemed only after it
///         matures, ten years on.
/// @dev    Security rules this contract is written to (see docs/THREAT_MODEL.md):
///         - No key, role or vote can move, redirect, pause or freeze deposits. There is no owner and no upgrade.
///         - BNB only ever leaves to StakeHub, or to a claimant withdrawing what their claim is owed.
///         - `receive()` does nothing: StakeHub pays unbonded BNB with a 5,000 gas stipend.
///         - Every step of a withdrawal can be performed by the owner alone, with no off-chain help.
///
///         Share ids: `(cohort << 2) | bucket`, bucket 0 = retirement (A), 1 = emergency (B). Id 2 holds protocol
///         fee shares, which have no lock.
///
///         Voting power: every retirement and emergency share is one vote for its holder, recorded over time so a
///         governor can read balances as they were when a proposal started (ERC-5805 reads, timestamp clock, no
///         delegation). Fee shares carry no votes, so the treasury that receives them cannot vote with them.
contract LadderVault is ERC1155Supply, ReentrancyGuard {
    using Math for uint256;
    using Checkpoints for Checkpoints.Trace208;

    // ---------------------------------------------------------------- constants

    IStakeHub public constant STAKE_HUB = IStakeHub(0x0000000000000000000000000000000000002002);

    /// @notice One cohort. The average Gregorian month: 365.2425 days / 12.
    uint256 public constant EPOCH = 2_629_746;
    /// @notice A cohort matures this many epochs after it ends: ten years.
    uint256 public constant LOCK_EPOCHS = 120;

    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_RETIREMENT_BPS = 7_000;
    uint256 public constant FEE_BPS = 3_000;

    uint8 public constant BUCKET_RETIREMENT = 0;
    uint8 public constant BUCKET_EMERGENCY = 1;
    uint256 public constant FEE_SHARES_ID = 2;

    uint256 public constant MAX_VALIDATORS = 16;
    /// @notice Unbond requests claimed from StakeHub per validator per call, keeping gas bounded.
    uint256 public constant STAKE_HUB_CLAIM_BATCH = 50;
    /// @notice The curator may redelegate at most this share of staked BNB per window.
    uint256 public constant REDELEGATE_LIMIT_BPS = 1_000;
    uint256 public constant REDELEGATE_WINDOW = 7 days;

    /// @dev Virtual shares and assets (OpenZeppelin ERC-4626 style) make share-inflation attacks unprofitable.
    uint256 internal constant VIRTUAL_SHARES = 1e3;
    uint256 internal constant VIRTUAL_ASSETS = 1;
    uint256 internal constant PRICE_SCALE = 1e18;

    // ---------------------------------------------------------------- immutables

    uint256 public immutable GENESIS;
    /// @notice The only address allowed to move emergency-bucket shares. Fixed at deployment.
    address public immutable MARKET;
    uint256 public immutable MIN_DEPOSIT;
    uint256 public immutable MAX_DEPOSIT;
    /// @notice Total pool size allowed in epoch 0; grows by `CAP_GROWTH_PER_EPOCH` each epoch.
    uint256 public immutable CAP_INITIAL;
    uint256 public immutable CAP_GROWTH_PER_EPOCH;
    /// @notice From this epoch on, the pool is uncapped.
    uint256 public immutable CAP_REMOVED_AT_EPOCH;

    // ---------------------------------------------------------------- state

    /// @notice Receives fee shares. Can only hand the role to an address that accepts it.
    address public feeRecipient;
    address public pendingFeeRecipient;

    /// @notice Chooses validators and rebalances between them. Cannot withdraw or send BNB anywhere.
    address public curator;
    address public pendingCurator;

    address[] internal _validators;
    mapping(address operator => bool) public isValidator;

    /// @notice BNB sitting in StakeHub unbond queues on the vault's behalf.
    uint256 public unbonding;
    /// @notice BNB owed to claims that have not been withdrawn. Excluded from the pool.
    uint256 public outstandingClaims;
    /// @notice BNB that must stay in the vault's balance because claims are waiting on it: the idle BNB set aside
    ///         when a claim was made, plus everything that has come back from unbonding. `flush` never touches it.
    uint256 public reservedLiquidity;
    /// @notice Share price (scaled 1e18) above which fees are charged.
    uint256 public highWaterMark;

    uint256 public redelegateWindowStart;
    uint256 public redelegatedInWindow;

    struct Claim {
        address owner;
        uint64 readyAt;
        bool withdrawn;
        uint256 amount;
    }

    Claim[] internal _claims;

    mapping(address account => Checkpoints.Trace208) internal _votes;
    Checkpoints.Trace208 internal _totalVotes;

    // ---------------------------------------------------------------- events

    event Deposited(
        address indexed sender,
        address indexed receiver,
        uint256 indexed cohort,
        uint256 bnb,
        uint256 sharesA,
        uint256 sharesB
    );
    event Flushed(address indexed validator, uint256 bnb);
    event ClaimRequested(
        uint256 indexed claimId,
        address indexed owner,
        uint256 indexed shareId,
        uint256 shares,
        uint256 bnb,
        uint64 readyAt
    );
    event Withdrawn(uint256 indexed claimId, address indexed receiver, uint256 bnb);
    event Collected(address indexed validator, uint256 bnb);
    event FeeAccrued(uint256 feeShares, uint256 feeBnb, uint256 highWaterMark);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event Redelegated(address indexed from, address indexed to, uint256 shares, uint256 bnb, bool rescue);
    event CuratorTransferStarted(address indexed from, address indexed to);
    event CuratorTransferred(address indexed from, address indexed to);
    event FeeRecipientTransferStarted(address indexed from, address indexed to);
    event FeeRecipientTransferred(address indexed from, address indexed to);

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error InvalidAmount();
    error InvalidSplit();
    error DepositCapExceeded(uint256 cap);
    error NotMatured(uint256 maturesAt);
    error InvalidShareId();
    error TransferRestricted(uint256 id);
    error NothingToFlush();
    error NoDelegationTarget();
    error ClaimNotReady(uint64 readyAt);
    error AlreadyWithdrawn();
    error NotClaimOwner();
    error InsufficientLiquidity();
    error InsufficientStake();
    error WithdrawFailed();
    error NotCurator();
    error NotPendingRole();
    error NotFeeRecipient();
    error ValidatorLimit();
    error UnknownValidator();
    error ValidatorAlreadyListed();
    error ValidatorJailed();
    error ValidatorStillHoldsStake();
    error RedelegateLimitExceeded(uint256 remaining);
    error SameValidator();
    error FutureLookup(uint256 timepoint, uint48 clock);

    // ---------------------------------------------------------------- setup

    struct Config {
        address market;
        address feeRecipient;
        address curator;
        address[] validators;
        uint256 minDeposit;
        uint256 maxDeposit;
        uint256 capInitial;
        uint256 capGrowthPerEpoch;
        uint256 capRemovedAtEpoch;
    }

    constructor(Config memory cfg) ERC1155("") {
        if (cfg.market == address(0) || cfg.feeRecipient == address(0) || cfg.curator == address(0)) {
            revert ZeroAddress();
        }
        if (cfg.minDeposit == 0 || cfg.maxDeposit < cfg.minDeposit) revert InvalidAmount();

        GENESIS = block.timestamp;
        MARKET = cfg.market;
        MIN_DEPOSIT = cfg.minDeposit;
        MAX_DEPOSIT = cfg.maxDeposit;
        CAP_INITIAL = cfg.capInitial;
        CAP_GROWTH_PER_EPOCH = cfg.capGrowthPerEpoch;
        CAP_REMOVED_AT_EPOCH = cfg.capRemovedAtEpoch;

        feeRecipient = cfg.feeRecipient;
        curator = cfg.curator;
        for (uint256 i; i < cfg.validators.length; ++i) {
            _addValidator(cfg.validators[i]);
        }

        highWaterMark = _price(0, 0);
    }

    /// @notice Accepts BNB and does nothing else. StakeHub pays unbonded BNB with only 5,000 gas, so this must
    ///         never grow. BNB sent here directly (not through `deposit`) becomes a gift to every depositor.
    receive() external payable {}

    // ---------------------------------------------------------------- cohorts

    function cohortAt(uint256 timestamp) public view returns (uint256) {
        return (timestamp - GENESIS) / EPOCH;
    }

    function currentCohort() public view returns (uint256) {
        return cohortAt(block.timestamp);
    }

    /// @notice A cohort matures at the end of the epoch `LOCK_EPOCHS` after it: at least ten years for every
    ///         deposit in it.
    function maturityOf(uint256 cohort) public view returns (uint256) {
        return GENESIS + (cohort + 1 + LOCK_EPOCHS) * EPOCH;
    }

    function shareId(uint256 cohort, uint8 bucket) public pure returns (uint256) {
        if (bucket > BUCKET_EMERGENCY) revert InvalidShareId();
        return (cohort << 2) | bucket;
    }

    function depositCap() public view returns (uint256) {
        uint256 epoch = currentCohort();
        if (epoch >= CAP_REMOVED_AT_EPOCH) return type(uint256).max;
        return CAP_INITIAL + epoch * CAP_GROWTH_PER_EPOCH;
    }

    // ---------------------------------------------------------------- voting power

    /// @notice ERC-6372 clock: voting power is recorded against block timestamps.
    function clock() public view returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() external pure returns (string memory) {
        return "mode=timestamp";
    }

    /// @notice Retirement and emergency shares `account` holds now, across every cohort.
    function getVotes(address account) external view returns (uint256) {
        return _votes[account].latest();
    }

    /// @notice Voting power `account` had at `timepoint`, which must be in the past.
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256) {
        return _votes[account].upperLookupRecent(_pastTimepoint(timepoint));
    }

    /// @notice All voting power in existence at `timepoint`: every retirement and emergency share.
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256) {
        return _totalVotes.upperLookupRecent(_pastTimepoint(timepoint));
    }

    // ---------------------------------------------------------------- accounting views

    /// @notice BNB belonging to shareholders: everything the vault holds, stakes or is unbonding, minus what is
    ///         owed to claims.
    function totalAssets() public view returns (uint256) {
        return _totalAssets(0);
    }

    function stakedBnb() public view returns (uint256 total) {
        for (uint256 i; i < _validators.length; ++i) {
            total += _pooledOf(_validators[i]);
        }
    }

    /// @notice Idle BNB not reserved for claims: what `flush` may delegate and what an instant claim may use.
    function delegatableBnb() public view returns (uint256) {
        uint256 balance = address(this).balance;
        return balance > reservedLiquidity ? balance - reservedLiquidity : 0;
    }

    function sharePrice() external view returns (uint256) {
        return _price(totalAssets(), totalSupply());
    }

    function previewDeposit(uint256 bnb) external view returns (uint256) {
        return bnb.mulDiv(totalSupply() + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS);
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return shares.mulDiv(totalAssets() + VIRTUAL_ASSETS, totalSupply() + VIRTUAL_SHARES);
    }

    function validators() external view returns (address[] memory) {
        return _validators;
    }

    function claimCount() external view returns (uint256) {
        return _claims.length;
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    // ---------------------------------------------------------------- deposit

    /// @notice Deposit BNB into the current cohort.
    /// @param receiver Who receives the shares.
    /// @param retirementBps Share of the deposit locked in the retirement bucket, at least 7,000 (70%).
    function deposit(address receiver, uint256 retirementBps)
        external
        payable
        nonReentrant
        returns (uint256 cohort, uint256 sharesA, uint256 sharesB)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (msg.value < MIN_DEPOSIT || msg.value > MAX_DEPOSIT) revert InvalidAmount();
        if (retirementBps < MIN_RETIREMENT_BPS || retirementBps > BPS) revert InvalidSplit();

        // msg.value is already in the balance: keep it out of fee accrual and pricing.
        _accrueFee(msg.value);
        uint256 assetsBefore = _totalAssets(msg.value);
        uint256 cap = depositCap();
        if (assetsBefore + msg.value > cap) revert DepositCapExceeded(cap);

        uint256 shares = msg.value.mulDiv(totalSupply() + VIRTUAL_SHARES, assetsBefore + VIRTUAL_ASSETS);
        if (shares == 0) revert InvalidAmount();

        cohort = currentCohort();
        sharesA = shares.mulDiv(retirementBps, BPS);
        sharesB = shares - sharesA;

        emit Deposited(msg.sender, receiver, cohort, msg.value, sharesA, sharesB);

        // Minting calls back into contract receivers, so it happens last.
        uint256[] memory ids = new uint256[](sharesB == 0 ? 1 : 2);
        uint256[] memory amounts = new uint256[](ids.length);
        ids[0] = shareId(cohort, BUCKET_RETIREMENT);
        amounts[0] = sharesA;
        if (sharesB != 0) {
            ids[1] = shareId(cohort, BUCKET_EMERGENCY);
            amounts[1] = sharesB;
        }
        _mintBatch(receiver, ids, amounts, "");
    }

    /// @notice Delegate idle BNB to the listed validator holding the least stake. Anyone may call.
    function flush() external nonReentrant returns (address target, uint256 amount) {
        amount = delegatableBnb();
        if (amount == 0 || amount < STAKE_HUB.minDelegationBNBChange()) revert NothingToFlush();

        uint256 least = type(uint256).max;
        for (uint256 i; i < _validators.length; ++i) {
            address op = _validators[i];
            if (_isJailed(op)) continue;
            uint256 staked = _pooledOf(op);
            if (staked < least) {
                least = staked;
                target = op;
            }
        }
        if (target == address(0)) revert NoDelegationTarget();

        emit Flushed(target, amount);
        STAKE_HUB.delegate{value: amount}(target, false);
    }

    // ---------------------------------------------------------------- claims

    /// @notice Redeem matured shares. Burns them and fixes the BNB owed. The BNB is withdrawable immediately if
    ///         the vault holds enough idle BNB, otherwise after StakeHub's unbonding period.
    function requestClaim(uint256 id, uint256 shares) external nonReentrant returns (uint256 claimId) {
        if (shares == 0) revert InvalidAmount();
        if (id != FEE_SHARES_ID) {
            if (id & 3 > BUCKET_EMERGENCY) revert InvalidShareId();
            uint256 maturesAt = maturityOf(id >> 2);
            if (block.timestamp < maturesAt) revert NotMatured(maturesAt);
        }

        _accrueFee(0);
        uint256 amount = shares.mulDiv(_totalAssets(0) + VIRTUAL_ASSETS, totalSupply() + VIRTUAL_SHARES);
        if (amount == 0) revert InvalidAmount();

        _burn(msg.sender, id, shares);

        // BNB set aside for claims beyond what they are owed: wei left over from rounding unbonds up.
        uint256 earmarked = reservedLiquidity + unbonding;
        uint256 surplus = earmarked > outstandingClaims ? earmarked - outstandingClaims : 0;
        outstandingClaims += amount;

        // A claim is instant only if idle BNB covers all of it. Otherwise it takes the idle BNB, then the surplus
        // (which may still be unbonding), and unbonds the rest. idle + surplus + staked always equals the pool, and
        // no claim is worth more than the pool, so the unbond can never come up short.
        uint64 readyAt = uint64(block.timestamp);
        uint256 idle = delegatableBnb();
        if (idle >= amount) {
            reservedLiquidity += amount;
        } else {
            reservedLiquidity += idle;
            uint256 toUnbond = amount - idle;
            toUnbond = toUnbond > surplus ? toUnbond - surplus : 0;
            if (toUnbond != 0) _undelegate(toUnbond);
            readyAt = uint64(block.timestamp + STAKE_HUB.unbondPeriod());
        }

        claimId = _claims.length;
        _claims.push(Claim({owner: msg.sender, readyAt: readyAt, withdrawn: false, amount: amount}));
        emit ClaimRequested(claimId, msg.sender, id, shares, amount, readyAt);
    }

    /// @notice Pay a ready claim to its owner.
    function withdraw(uint256 claimId) external {
        _withdraw(claimId, _claims[claimId].owner);
    }

    /// @notice Pay a ready claim to another address. Only the claim's owner may choose where it goes, which also
    ///         rescues a claim whose owner cannot receive BNB.
    function withdrawTo(uint256 claimId, address receiver) external {
        if (msg.sender != _claims[claimId].owner) revert NotClaimOwner();
        if (receiver == address(0)) revert ZeroAddress();
        _withdraw(claimId, receiver);
    }

    /// @notice Pull BNB whose unbonding has finished back from StakeHub. Anyone may call.
    function collect() external nonReentrant {
        _collect();
    }

    /// @notice Charge any fee owed since the last high-water mark. Anyone may call.
    function accrueFee() external nonReentrant {
        _accrueFee(0);
    }

    // ---------------------------------------------------------------- curator

    function addValidator(address operator) external onlyCurator {
        _addValidator(operator);
    }

    /// @notice Only a validator the vault no longer has any stake or pending unbonds with can be removed.
    function removeValidator(address operator) external onlyCurator {
        if (!isValidator[operator]) revert UnknownValidator();
        IStakeCredit credit = _credit(operator);
        if (credit.balanceOf(address(this)) != 0 || credit.pendingUnbondRequest(address(this)) != 0) {
            revert ValidatorStillHoldsStake();
        }
        isValidator[operator] = false;
        for (uint256 i; i < _validators.length; ++i) {
            if (_validators[i] == operator) {
                _validators[i] = _validators[_validators.length - 1];
                _validators.pop();
                break;
            }
        }
        emit ValidatorRemoved(operator);
    }

    /// @notice Move stake between listed validators. The curator is rate-limited. Anyone may move stake away
    ///         from a jailed validator, with no limit, since jailed validators earn nothing.
    function redelegate(address from, address to, uint256 shares) external nonReentrant {
        if (from == to) revert SameValidator();
        if (!isValidator[from] || !isValidator[to]) revert UnknownValidator();
        if (_isJailed(to)) revert ValidatorJailed();

        bool rescue = _isJailed(from);
        IStakeCredit fromCredit = _credit(from);
        if (shares == 0 || shares > fromCredit.balanceOf(address(this))) revert InvalidAmount();
        uint256 bnb = fromCredit.getPooledBNBByShares(shares);
        if (!rescue) {
            if (msg.sender != curator) revert NotCurator();
            if (block.timestamp >= redelegateWindowStart + REDELEGATE_WINDOW) {
                redelegateWindowStart = block.timestamp;
                redelegatedInWindow = 0;
            }
            uint256 limit = stakedBnb().mulDiv(REDELEGATE_LIMIT_BPS, BPS);
            uint256 used = redelegatedInWindow + bnb;
            if (used > limit) revert RedelegateLimitExceeded(limit - redelegatedInWindow);
            redelegatedInWindow = used;
        }

        emit Redelegated(from, to, shares, bnb, rescue);
        STAKE_HUB.redelegate(from, to, shares, false);
    }

    function transferCurator(address next) external onlyCurator {
        pendingCurator = next;
        emit CuratorTransferStarted(curator, next);
    }

    function acceptCurator() external {
        if (msg.sender != pendingCurator || msg.sender == address(0)) revert NotPendingRole();
        emit CuratorTransferred(curator, msg.sender);
        curator = msg.sender;
        pendingCurator = address(0);
    }

    function transferFeeRecipient(address next) external {
        if (msg.sender != feeRecipient) revert NotFeeRecipient();
        pendingFeeRecipient = next;
        emit FeeRecipientTransferStarted(feeRecipient, next);
    }

    function acceptFeeRecipient() external nonReentrant {
        if (msg.sender != pendingFeeRecipient || msg.sender == address(0)) revert NotPendingRole();
        _accrueFee(0); // fees earned so far belong to the outgoing recipient
        emit FeeRecipientTransferred(feeRecipient, msg.sender);
        feeRecipient = msg.sender;
        pendingFeeRecipient = address(0);
    }

    modifier onlyCurator() {
        if (msg.sender != curator) revert NotCurator();
        _;
    }

    // ---------------------------------------------------------------- transfer rules

    /// @dev Retirement shares never move. Emergency shares move only through the market, and only before their
    ///      cohort matures. Fee shares move freely. Enforced here so no other contract can loosen it.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155Supply)
    {
        if (from != address(0) && to != address(0)) {
            for (uint256 i; i < ids.length; ++i) {
                uint256 id = ids[i];
                if (id == FEE_SHARES_ID) continue;
                uint256 bucket = id & 3;
                if (
                    bucket == BUCKET_EMERGENCY && msg.sender == MARKET
                        && block.timestamp < maturityOf(id >> 2)
                ) {
                    continue;
                }
                revert TransferRestricted(id);
            }
        }
        super._update(from, to, ids, values);

        uint256 moved;
        for (uint256 i; i < ids.length; ++i) {
            if (ids[i] != FEE_SHARES_ID) moved += values[i];
        }
        if (moved == 0) return;
        uint48 now_ = clock();
        uint208 delta = SafeCast.toUint208(moved);
        if (from == address(0)) {
            _totalVotes.push(now_, _totalVotes.latest() + delta);
        } else {
            _votes[from].push(now_, _votes[from].latest() - delta);
        }
        if (to == address(0)) {
            _totalVotes.push(now_, _totalVotes.latest() - delta);
        } else {
            _votes[to].push(now_, _votes[to].latest() + delta);
        }
    }

    /// @dev An EIP-7702 delegated EOA is controlled by its private key whatever code it delegates to, so its owner
    ///      can always redeem shares directly. Skip the ERC-1155 receiver hook for those accounts, so a delegate
    ///      without one does not lock its owner out of depositing or buying. Real contracts keep the standard check.
    function _updateWithAcceptanceCheck(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data,
        bool batch
    ) internal override {
        if (_isDelegatedEoa(to)) {
            _update(from, to, ids, values);
            return;
        }
        super._updateWithAcceptanceCheck(from, to, ids, values, data, batch);
    }

    /// @dev EIP-7702 delegation designator: exactly 0xef0100 followed by a 20-byte address.
    function _isDelegatedEoa(address account) internal view returns (bool) {
        if (account.code.length != 23) return false;
        bytes memory code = account.code;
        return code[0] == 0xef && code[1] == 0x01 && code[2] == 0x00;
    }

    // ---------------------------------------------------------------- internals

    function _pastTimepoint(uint256 timepoint) internal view returns (uint48) {
        uint48 now_ = clock();
        if (timepoint >= now_) revert FutureLookup(timepoint, now_);
        return SafeCast.toUint48(timepoint);
    }

    function _withdraw(uint256 claimId, address receiver) internal nonReentrant {
        Claim storage c = _claims[claimId];
        if (c.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < c.readyAt) revert ClaimNotReady(c.readyAt);

        // Collect first, so a claim paid from BNB that just finished unbonding never uses liquidity reserved for
        // another claim.
        _collect();
        // Pay only from liquidity reserved for claims, never from the pool's idle BNB.
        if (reservedLiquidity < c.amount) revert InsufficientLiquidity();

        c.withdrawn = true;
        outstandingClaims -= c.amount;
        reservedLiquidity -= c.amount;
        emit Withdrawn(claimId, receiver, c.amount);

        (bool ok,) = receiver.call{value: c.amount}("");
        if (!ok) revert WithdrawFailed();
    }

    function _collect() internal {
        for (uint256 i; i < _validators.length; ++i) {
            address op = _validators[i];
            if (_credit(op).claimableUnbondRequest(address(this)) == 0) continue;
            uint256 before = address(this).balance;
            STAKE_HUB.claim(op, STAKE_HUB_CLAIM_BATCH);
            uint256 received = address(this).balance - before;
            unbonding -= received > unbonding ? unbonding : received;
            reservedLiquidity += received; // unbonding only ever happens for claims
            emit Collected(op, received);
        }
    }

    /// @dev Unbond at least `bnbNeeded`, taking from the most-staked validators first.
    function _undelegate(uint256 bnbNeeded) internal {
        uint256 remaining = bnbNeeded;
        while (remaining != 0) {
            (address op, uint256 staked) = _mostStaked();
            if (staked == 0) revert InsufficientStake();

            IStakeCredit credit = _credit(op);
            uint256 take = remaining < staked ? remaining : staked;
            uint256 held = credit.balanceOf(address(this));
            // Round shares up so rounding inside StakeCredit never leaves claims short.
            uint256 shares = credit.getSharesByPooledBNB(take) + 1;
            if (shares > held) shares = held;
            uint256 bnb = credit.getPooledBNBByShares(shares);

            unbonding += bnb;
            remaining = bnb >= remaining ? 0 : remaining - bnb;
            STAKE_HUB.undelegate(op, shares);
        }
    }

    function _mostStaked() internal view returns (address op, uint256 most) {
        for (uint256 i; i < _validators.length; ++i) {
            uint256 staked = _pooledOf(_validators[i]);
            if (staked > most) {
                most = staked;
                op = _validators[i];
            }
        }
    }

    /// @dev Mints fee shares worth `FEE_BPS` of the gain above the high-water mark. Fee shares are credited
    ///      without the ERC-1155 receiver callback, so a fee recipient that rejects them can never block deposits
    ///      or claims.
    function _accrueFee(uint256 incoming) internal {
        uint256 supply = totalSupply();
        uint256 assets = _totalAssets(incoming);
        uint256 price = _price(assets, supply);
        if (supply == 0) {
            highWaterMark = price;
            return;
        }
        if (price <= highWaterMark) return;

        uint256 gain = (price - highWaterMark).mulDiv(supply + VIRTUAL_SHARES, PRICE_SCALE);
        uint256 feeBnb = gain.mulDiv(FEE_BPS, BPS);
        uint256 feeShares = feeBnb.mulDiv(supply + VIRTUAL_SHARES, assets + VIRTUAL_ASSETS - feeBnb);

        if (feeShares != 0) {
            uint256[] memory ids = new uint256[](1);
            uint256[] memory amounts = new uint256[](1);
            ids[0] = FEE_SHARES_ID;
            amounts[0] = feeShares;
            _update(address(0), feeRecipient, ids, amounts);
        }
        highWaterMark = _price(assets, supply + feeShares);
        emit FeeAccrued(feeShares, feeBnb, highWaterMark);
    }

    function _totalAssets(uint256 incoming) internal view returns (uint256) {
        uint256 gross = address(this).balance - incoming + stakedBnb() + unbonding;
        return gross > outstandingClaims ? gross - outstandingClaims : 0;
    }

    function _price(uint256 assets, uint256 supply) internal pure returns (uint256) {
        return (assets + VIRTUAL_ASSETS).mulDiv(PRICE_SCALE, supply + VIRTUAL_SHARES);
    }

    function _addValidator(address operator) internal {
        if (isValidator[operator]) revert ValidatorAlreadyListed();
        if (_validators.length >= MAX_VALIDATORS) revert ValidatorLimit();
        if (STAKE_HUB.getValidatorCreditContract(operator) == address(0)) revert UnknownValidator();
        if (_isJailed(operator)) revert ValidatorJailed();
        isValidator[operator] = true;
        _validators.push(operator);
        emit ValidatorAdded(operator);
    }

    /// @dev BNB value of the vault's stake with `operator`. StakeCredit's conversion functions revert when a
    ///      validator has no shares at all, which would take every accounting path down with it. Holding shares
    ///      guarantees the total is non-zero, so skip validators where the vault holds none.
    function _pooledOf(address operator) internal view returns (uint256) {
        IStakeCredit credit = _credit(operator);
        uint256 held = credit.balanceOf(address(this));
        return held == 0 ? 0 : credit.getPooledBNBByShares(held);
    }

    function _credit(address operator) internal view returns (IStakeCredit) {
        return IStakeCredit(STAKE_HUB.getValidatorCreditContract(operator));
    }

    function _isJailed(address operator) internal view returns (bool jailed) {
        (, jailed,) = STAKE_HUB.getValidatorBasicInfo(operator);
    }
}
