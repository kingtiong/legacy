// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Mirrors BNB Chain's StakeCredit arithmetic and failure modes (bsc-genesis-contract), including the
///         reverts on empty pools and the 5,000 gas stipend on unbond payouts.
contract MockStakeCredit {
    address public immutable HUB;
    address public immutable validator;

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    uint256 public totalPooledBNB;

    struct UnbondRequest {
        uint256 shares;
        uint256 bnbAmount;
        uint256 unlockTime;
    }

    mapping(address => UnbondRequest[]) internal _queue;
    mapping(address => uint256) internal _head;

    error ZeroTotalShares();
    error ZeroTotalPooledBNB();
    error TransferNotAllowed();
    error NoUnbondRequest();
    error NoClaimableUnbondRequest();
    error TransferFailed();
    error InsufficientBalance();
    error ZeroShares();
    error ZeroAmount();
    error OnlyStakeHub();

    constructor(address validator_) {
        HUB = msg.sender;
        validator = validator_;
    }

    modifier onlyHub() {
        if (msg.sender != HUB) revert OnlyStakeHub();
        _;
    }

    receive() external payable {}

    function getPooledBNBByShares(uint256 shares) public view returns (uint256) {
        if (totalSupply == 0) revert ZeroTotalShares();
        return (shares * totalPooledBNB) / totalSupply;
    }

    function getSharesByPooledBNB(uint256 bnbAmount) public view returns (uint256) {
        if (totalPooledBNB == 0) revert ZeroTotalPooledBNB();
        return (bnbAmount * totalSupply) / totalPooledBNB;
    }

    function getPooledBNB(address account) external view returns (uint256) {
        return getPooledBNBByShares(balanceOf[account]);
    }

    function seed() external payable onlyHub {
        balanceOf[validator] += msg.value;
        totalSupply += msg.value;
        totalPooledBNB += msg.value;
    }

    function delegate(address delegator) external payable onlyHub returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        shares = _mintAndSync(delegator, msg.value);
        if (shares == 0) revert ZeroShares();
    }

    function undelegate(address delegator, uint256 shares) external onlyHub returns (uint256 bnbAmount) {
        if (shares == 0) revert ZeroShares();
        if (shares > balanceOf[delegator]) revert InsufficientBalance();
        bnbAmount = _burnAndSync(delegator, shares);
        _queue[delegator].push(
            UnbondRequest({
                shares: shares,
                bnbAmount: bnbAmount,
                unlockTime: block.timestamp + MockStakeHub(payable(HUB)).unbondPeriod()
            })
        );
    }

    function unbond(address delegator, uint256 shares) external onlyHub returns (uint256 bnbAmount) {
        if (shares == 0) revert ZeroShares();
        if (shares > balanceOf[delegator]) revert InsufficientBalance();
        bnbAmount = _burnAndSync(delegator, shares);
        (bool ok,) = HUB.call{value: bnbAmount}("");
        if (!ok) revert TransferFailed();
    }

    function claim(address payable delegator, uint256 number) external onlyHub returns (uint256 total) {
        uint256 length = _queue[delegator].length - _head[delegator];
        if (length == 0) revert NoUnbondRequest();
        number = (number == 0 || number > length) ? length : number;
        while (number != 0) {
            UnbondRequest memory r = _queue[delegator][_head[delegator]];
            if (block.timestamp < r.unlockTime) break;
            ++_head[delegator];
            total += r.bnbAmount;
            --number;
        }
        if (total == 0) revert NoClaimableUnbondRequest();
        (bool ok,) = delegator.call{gas: MockStakeHub(payable(HUB)).transferGasLimit(), value: total}("");
        if (!ok) revert TransferFailed();
    }

    function pendingUnbondRequest(address delegator) external view returns (uint256) {
        return _queue[delegator].length - _head[delegator];
    }

    function claimableUnbondRequest(address delegator) external view returns (uint256 count) {
        for (uint256 i = _head[delegator]; i < _queue[delegator].length; ++i) {
            if (block.timestamp < _queue[delegator][i].unlockTime) break;
            ++count;
        }
    }

    function lockedBNBs(address delegator, uint256 number) external view returns (uint256 total) {
        uint256 length = _queue[delegator].length - _head[delegator];
        number = (number == 0 || number > length) ? length : number;
        for (uint256 i; i < number; ++i) {
            total += _queue[delegator][_head[delegator] + i].bnbAmount;
        }
    }

    /// @dev Real StakeCredit: rewards minus commission join the pool; commission is minted to the validator.
    function distributeReward(uint256 commissionBps) external payable onlyHub {
        uint256 commission = (msg.value * commissionBps) / 10_000;
        totalPooledBNB += msg.value - commission;
        if (commission != 0) _mintAndSync(validator, commission);
    }

    /// @dev Real StakeCredit: slashing burns only the validator's own shares, so delegators keep their value.
    function slash(uint256 bnbAmount) external onlyHub returns (uint256 real) {
        uint256 slashShares = getSharesByPooledBNB(bnbAmount);
        uint256 selfShares = balanceOf[validator];
        slashShares = slashShares > selfShares ? selfShares : slashShares;
        real = _burnAndSync(validator, slashShares);
        payable(address(0xdead)).transfer(real);
    }

    /// @dev Test-only: a loss that does reach delegators, for exercising the fee high-water mark.
    function simulateLoss(uint256 bnbAmount) external onlyHub {
        totalPooledBNB -= bnbAmount;
        payable(address(0xdead)).transfer(bnbAmount);
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert TransferNotAllowed();
    }

    function _mintAndSync(address account, uint256 bnbAmount) internal returns (uint256 shares) {
        shares = getSharesByPooledBNB(bnbAmount);
        balanceOf[account] += shares;
        totalSupply += shares;
        totalPooledBNB += bnbAmount;
    }

    function _burnAndSync(address account, uint256 shares) internal returns (uint256 bnbAmount) {
        bnbAmount = getPooledBNBByShares(shares);
        balanceOf[account] -= shares;
        totalSupply -= shares;
        totalPooledBNB -= bnbAmount;
    }
}

/// @notice Mirrors the parts of BNB Chain's StakeHub the vault uses. Etched at 0x...2002 in tests.
contract MockStakeHub {
    uint256 public constant minDelegationBNBChange = 1 ether;
    uint256 public constant unbondPeriod = 7 days;
    uint256 public constant transferGasLimit = 5000;
    uint256 public constant redelegateFeeRate = 2;
    uint256 public constant REDELEGATE_FEE_RATE_BASE = 100_000;

    mapping(address => address) public getValidatorCreditContract;
    mapping(address => bool) public jailed;
    address[] internal _operators;
    uint256 public commissionBps;

    error DelegationAmountTooSmall();
    error OnlySelfDelegation();
    error ValidatorNotExisted();
    error SameValidator();
    error ZeroShares();

    receive() external payable {}

    modifier exists(address op) {
        if (getValidatorCreditContract[op] == address(0)) revert ValidatorNotExisted();
        _;
    }

    // ---- test controls ----

    function createValidator(address operator) external payable returns (address credit) {
        credit = address(new MockStakeCredit(operator));
        getValidatorCreditContract[operator] = credit;
        _operators.push(operator);
        MockStakeCredit(payable(credit)).seed{value: msg.value}();
    }

    function setJailed(address operator, bool value) external {
        jailed[operator] = value;
    }

    function setCommissionBps(uint256 bps) external {
        commissionBps = bps;
    }

    function reward(address operator) external payable exists(operator) {
        MockStakeCredit(payable(getValidatorCreditContract[operator])).distributeReward{value: msg.value}(
            commissionBps
        );
    }

    function slash(address operator, uint256 bnbAmount) external exists(operator) {
        MockStakeCredit(payable(getValidatorCreditContract[operator])).slash(bnbAmount);
    }

    function simulateLoss(address operator, uint256 bnbAmount) external exists(operator) {
        MockStakeCredit(payable(getValidatorCreditContract[operator])).simulateLoss(bnbAmount);
    }

    // ---- StakeHub interface ----

    function delegate(address operatorAddress, bool) external payable exists(operatorAddress) {
        if (msg.value < minDelegationBNBChange) revert DelegationAmountTooSmall();
        if (jailed[operatorAddress] && msg.sender != operatorAddress) revert OnlySelfDelegation();
        MockStakeCredit(payable(getValidatorCreditContract[operatorAddress])).delegate{value: msg.value}(
            msg.sender
        );
    }

    function undelegate(address operatorAddress, uint256 shares) external exists(operatorAddress) {
        if (shares == 0) revert ZeroShares();
        MockStakeCredit(payable(getValidatorCreditContract[operatorAddress])).undelegate(msg.sender, shares);
    }

    function redelegate(address src, address dst, uint256 shares, bool) external exists(src) exists(dst) {
        if (shares == 0) revert ZeroShares();
        if (src == dst) revert SameValidator();
        if (jailed[dst] && msg.sender != dst) revert OnlySelfDelegation();
        uint256 bnb = MockStakeCredit(payable(getValidatorCreditContract[src])).unbond(msg.sender, shares);
        if (bnb < minDelegationBNBChange) revert DelegationAmountTooSmall();
        uint256 fee = (bnb * redelegateFeeRate) / REDELEGATE_FEE_RATE_BASE;
        MockStakeCredit(payable(getValidatorCreditContract[dst])).delegate{value: bnb - fee}(msg.sender);
    }

    function claim(address operatorAddress, uint256 requestNumber) external {
        MockStakeCredit(payable(getValidatorCreditContract[operatorAddress]))
            .claim(payable(msg.sender), requestNumber);
    }

    function getValidators(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory ops, address[] memory credits, uint256 total)
    {
        total = _operators.length;
        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 n = end > offset ? end - offset : 0;
        ops = new address[](n);
        credits = new address[](n);
        for (uint256 i; i < n; ++i) {
            ops[i] = _operators[offset + i];
            credits[i] = getValidatorCreditContract[ops[i]];
        }
    }

    function getValidatorBasicInfo(address operatorAddress)
        external
        view
        returns (uint256 createdTime, bool isJailed, uint256 jailUntil)
    {
        return (0, jailed[operatorAddress], 0);
    }
}
