// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IStakeHub, IStakeCredit} from "../../src/interfaces/IStakeHub.sol";

/// @dev Acts as a delegator, the way the vault will. Children differ only in what `receive` costs.
abstract contract Delegator {
    IStakeHub internal constant HUB = IStakeHub(0x0000000000000000000000000000000000002002);

    function doDelegate(address operator) external payable {
        HUB.delegate{value: msg.value}(operator, false);
    }

    function doUndelegate(address operator, uint256 shares) external {
        HUB.undelegate(operator, shares);
    }

    function doClaim(address operator, uint256 number) external {
        HUB.claim(operator, number);
    }

    function doTransferCredit(IStakeCredit credit, address to, uint256 amount) external {
        credit.transfer(to, amount);
    }
}

/// @dev What the vault must look like: accepting BNB does nothing else.
contract CheapDelegator is Delegator {
    receive() external payable {}
}

/// @dev The trap: bookkeeping on receipt needs far more than the 5000 gas StakeHub forwards.
contract BookkeepingDelegator is Delegator {
    uint256 public totalReceived;

    receive() external payable {
        totalReceived += msg.value;
    }
}

/// @title Pins every StakeHub behaviour the vault depends on
/// @notice Runs against a live BNB Chain mainnet fork. If BNB Chain changes any of this, these tests fail
///         and the vault's design must be revisited before it is deployed or touched.
///         Run with: forge test --match-path test/fork/* (set BSC_RPC_URL to use your own node).
contract StakeHubAssumptionsTest is Test {
    IStakeHub internal constant HUB = IStakeHub(0x0000000000000000000000000000000000002002);

    address internal validator;
    IStakeCredit internal credit;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.bnbchain.org")));
        validator = _firstValidator({jailed: false});
        require(validator != address(0), "no active validator found");
        credit = IStakeCredit(HUB.getValidatorCreditContract(validator));
    }

    // ---- parameters the design is built around ----

    function test_minimumDelegationIsOneBnb() public view {
        assertEq(HUB.minDelegationBNBChange(), 1 ether, "deposit batching assumes a 1 BNB minimum");
    }

    function test_unbondPeriodIsSevenDays() public view {
        assertEq(HUB.unbondPeriod(), 7 days, "claim flow and UI copy assume a 7-day unbond");
    }

    function test_claimGasStipendIs5000() public view {
        assertEq(HUB.transferGasLimit(), 5000, "the vault's receive() must fit inside this stipend");
    }

    // ---- delegation ----

    function test_delegateBelowMinimumReverts() public {
        CheapDelegator d = new CheapDelegator();
        vm.expectRevert(bytes4(keccak256("DelegationAmountTooSmall()")));
        d.doDelegate{value: 1 ether - 1}(validator);
    }

    function test_creditsCannotBeTransferred() public {
        CheapDelegator d = new CheapDelegator();
        d.doDelegate{value: 1 ether}(validator);
        uint256 shares = credit.balanceOf(address(d));
        assertGt(shares, 0);
        vm.expectRevert(bytes4(keccak256("TransferNotAllowed()")));
        d.doTransferCredit(credit, address(0xBEEF), shares);
    }

    // ---- withdrawal: the part that must still work in ten years ----

    function test_undelegateHasNoMinimum() public {
        CheapDelegator d = new CheapDelegator();
        d.doDelegate{value: 1 ether}(validator);
        uint256 tinyShares = credit.getSharesByPooledBNB(0.001 ether);
        d.doUndelegate(validator, tinyShares);
        assertEq(credit.pendingUnbondRequest(address(d)), 1);
    }

    function test_claimPaysReceiverThatOnlyAcceptsBnb() public {
        CheapDelegator d = new CheapDelegator();
        uint256 locked = _delegateAndUndelegateAll(d);
        vm.warp(block.timestamp + HUB.unbondPeriod() + 1);
        uint256 before = address(d).balance;
        d.doClaim(validator, 0);
        assertEq(address(d).balance - before, locked, "full unbonded amount should arrive");
    }

    function test_claimFailsForReceiverThatWritesStorage() public {
        BookkeepingDelegator d = new BookkeepingDelegator();
        _delegateAndUndelegateAll(d);
        vm.warp(block.timestamp + HUB.unbondPeriod() + 1);
        vm.expectRevert();
        d.doClaim(validator, 0);
    }

    function test_claimBeforeUnbondPeriodReverts() public {
        CheapDelegator d = new CheapDelegator();
        _delegateAndUndelegateAll(d);
        vm.warp(block.timestamp + HUB.unbondPeriod() - 1);
        vm.expectRevert(bytes4(keccak256("NoClaimableUnbondRequest()")));
        d.doClaim(validator, 0);
    }

    function test_manySmallRequestsCanBeClaimedInBoundedBatches() public {
        CheapDelegator d = new CheapDelegator();
        d.doDelegate{value: 2 ether}(validator);
        uint256 slice = credit.getSharesByPooledBNB(0.01 ether);
        for (uint256 i; i < 30; ++i) {
            d.doUndelegate(validator, slice);
        }
        assertEq(credit.pendingUnbondRequest(address(d)), 30);
        vm.warp(block.timestamp + HUB.unbondPeriod() + 1);
        for (uint256 i; i < 3; ++i) {
            d.doClaim(validator, 10);
        }
        assertEq(credit.pendingUnbondRequest(address(d)), 0, "all 30 requests claimed, 10 at a time");
    }

    function test_jailedValidatorRefusesNewDelegation() public {
        address jailed = _firstValidator({jailed: true});
        if (jailed == address(0)) {
            vm.skip(true); // no validator is jailed at this block; nothing to check
            return;
        }
        CheapDelegator d = new CheapDelegator();
        vm.expectRevert(bytes4(keccak256("OnlySelfDelegation()")));
        d.doDelegate{value: 1 ether}(jailed);
    }

    // ---- helpers ----

    function _delegateAndUndelegateAll(Delegator d) internal returns (uint256 locked) {
        d.doDelegate{value: 1 ether}(validator);
        d.doUndelegate(validator, credit.balanceOf(address(d)));
        locked = credit.lockedBNBs(address(d), 0);
        assertGt(locked, 0.99 ether);
    }

    function _firstValidator(bool jailed) internal view returns (address) {
        (address[] memory ops,, uint256 total) = HUB.getValidators(0, 200);
        for (uint256 i; i < ops.length && i < total; ++i) {
            (, bool isJailed,) = HUB.getValidatorBasicInfo(ops[i]);
            if (isJailed == jailed) return ops[i];
        }
        return address(0);
    }
}
