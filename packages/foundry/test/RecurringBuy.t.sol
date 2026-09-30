// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { RecurringBuy } from "../contracts/RecurringBuy.sol";
import { ISaucerSwapV2Router } from "../contracts/interfaces/ISaucerSwapV2Router.sol";
import { MockHtsToken } from "../contracts/mocks/MockHtsToken.sol";
import { MockSaucerSwapRouter } from "../contracts/mocks/MockSaucerSwapRouter.sol";
import { MockScheduleService } from "../contracts/mocks/MockScheduleService.sol";
import { MockTokenService } from "../contracts/mocks/MockTokenService.sol";

/// The same behaviour as packages/hardhat/test/RecurringBuy.test.ts (in the template's Hardhat variant), on the
/// same mocks. Differences come from the tools: logs are read with `vm.recordLogs`, a tick's gas with
/// `vm.lastCallGas` and its call order with `vm.startStateDiffRecording`.
contract RecurringBuyTest is Test {
    MockScheduleService private constant HSS = MockScheduleService(address(0x16b));
    MockTokenService private constant HTS = MockTokenService(address(0x167));

    // HAPI response codes (ResponseCodeEnum ordinals).
    int64 private constant SUCCESS = 22;
    int64 private constant INSUFFICIENT_PAYER_BALANCE = 10;
    int64 private constant INVALID_TOKEN_ID = 167;
    int64 private constant INVALID_SCHEDULE_ID = 201;
    int64 private constant SCHEDULE_EXPIRY_IS_BUSY = 370;

    uint256 private constant INT64_MAX = uint256(uint64(type(int64).max));
    // SAUCE on testnet: supply type FINITE, maximum supply 10^15 in its smallest unit (docs/testnet-findings.md, D1).
    uint256 private constant SAUCE_MAX_SUPPLY = 10 ** 15;

    // A daily buy of 0.05 WHBAR (8 decimals) for SAUCE (6 decimals) with a 95% price floor, at the rate the
    // testnet WHBAR/SAUCE pool (fee 0.3%) paid for 0.05 WHBAR in a live run.
    uint24 private constant FEE = 3000;
    uint256 private constant AMOUNT_PER_TICK = 5_000_000;
    uint256 private constant SAUCE_PER_TICK = 2_046_098;
    uint256 private constant MIN_AMOUNT_OUT = 1_943_793;
    uint64 private constant PERIOD = 86_400;

    // The network bills the contract TICK_GAS_PRICE per gas used; the contract reserves at twice that, as the
    // deploy script sets it up.
    uint64 private constant TICK_GAS_LIMIT = 1_900_000;
    uint256 private constant TICK_GAS_PRICE = 100;
    uint256 private constant RESERVE_GAS_PRICE = 2 * TICK_GAS_PRICE;
    uint256 private constant RESERVE = TICK_GAS_LIMIT * RESERVE_GAS_PRICE;

    struct TickRun {
        bool success;
        bytes revertData;
        VmSafe.Log[] logs;
        uint256 gasUsed; // execution gas of the tick's call frame
        uint256 billed; // what the network took from the contract for it: gasUsed at the tick's gas price
    }

    struct Charge {
        uint256 gasCharged;
        uint256 gasPrice;
        uint256 amount;
    }

    RecurringBuy private recurringBuy;
    MockHtsToken private whbar;
    MockHtsToken private sauce;
    MockSaucerSwapRouter private router;
    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");
    address private stranger = makeAddr("stranger");

    function setUp() public {
        // The system contracts sit at fixed addresses on Hedera; put the mocks' runtime code there.
        vm.etch(address(HSS), address(new MockScheduleService()).code);
        HSS.setResponseCodes(SUCCESS, SUCCESS);
        vm.etch(address(HTS), address(new MockTokenService()).code);
        HTS.setResponseCode(SUCCESS);

        whbar = new MockHtsToken("Wrapped HBAR", "WHBAR", 8);
        sauce = new MockHtsToken("SAUCE", "SAUCE", 6);
        router = new MockSaucerSwapRouter();
        router.associate(address(whbar));
        router.setRate(SAUCE_PER_TICK, AMOUNT_PER_TICK);
        recurringBuy = new RecurringBuy(ISaucerSwapV2Router(address(router)), RESERVE_GAS_PRICE);

        // Alice and Bob hold WHBAR, can receive SAUCE, and allow the contract three slices each.
        address[2] memory users = [alice, bob];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            whbar.associate();
            sauce.associate();
            whbar.approve(address(recurringBuy), 3 * AMOUNT_PER_TICK);
            vm.stopPrank();
            whbar.mint(users[i], 10 * AMOUNT_PER_TICK);
            vm.deal(users[i], 100 * RESERVE);
        }
    }

    // ---- deployment ------------------------------------------------------------------------------------------

    function test_StoresTheRouterAndTheReservationGasPrice() public view {
        assertEq(address(recurringBuy.router()), address(router));
        assertEq(recurringBuy.reserveGasPrice(), RESERVE_GAS_PRICE);
    }

    function test_RejectsAZeroRouterOrAZeroReservationGasPrice() public {
        vm.expectRevert(RecurringBuy.InvalidConfig.selector);
        new RecurringBuy(ISaucerSwapV2Router(address(0)), RESERVE_GAS_PRICE);
        vm.expectRevert(RecurringBuy.InvalidConfig.selector);
        new RecurringBuy(ISaucerSwapV2Router(address(router)), 0);
    }

    // ---- start -----------------------------------------------------------------------------------------------

    function test_StoresThePlanAndKeepsTheDepositMinusTheFirstReservation() public {
        RecurringBuy.PlanParams memory params = _params();
        params.maxTicks = 3;
        uint256 aliceBefore = alice.balance;

        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.PlanCreated(1, alice, params, 3 * RESERVE);
        _start(alice, params, 3 * RESERVE);

        assertEq(alice.balance, aliceBefore - 3 * RESERVE);
        assertEq(address(recurringBuy).balance, 3 * RESERVE);
        RecurringBuy.Plan memory plan = recurringBuy.plans(1);
        assertEq(plan.owner, alice);
        assertTrue(plan.active);
        assertEq(plan.ticksDone, 0);
        assertEq(plan.tokenIn, address(whbar));
        assertEq(plan.fee, FEE);
        assertEq(plan.tokenOut, address(sauce));
        assertEq(plan.amountPerTick, AMOUNT_PER_TICK);
        assertEq(plan.minAmountOut, MIN_AMOUNT_OUT);
        assertEq(plan.period, PERIOD);
        assertEq(plan.maxTicks, 3);
        assertEq(plan.tickGasLimit, TICK_GAS_LIMIT);
        assertEq(plan.gasDeposit, 2 * RESERVE);
        assertEq(recurringBuy.planCount(), 1);
    }

    function test_AssociatesWithTheInputTokenAndApprovesTheRouterOncePerToken() public {
        vm.expectEmit(address(whbar));
        emit MockHtsToken.Associated(address(recurringBuy));
        _startPlan(alice);
        // WHBAR has an infinite supply: the router may take the largest HTS amount.
        assertEq(whbar.allowance(address(recurringBuy), address(router)), INT64_MAX);
        assertTrue(recurringBuy.tokenReady(address(whbar)));

        vm.recordLogs();
        _startPlan(bob);
        assertEq(_count(vm.getRecordedLogs(), address(whbar), MockHtsToken.Associated.selector), 0);
    }

    function test_ApprovesTheRouterForTheMaximumSupplyOfAFiniteSupplyToken() public {
        sauce.setMaxSupply(SAUCE_MAX_SUPPLY);
        HTS.setMaxSupply(address(sauce), int64(uint64(SAUCE_MAX_SUPPLY)));
        // The mock refuses an allowance over the maximum supply, as SAUCE did on testnet.
        vm.prank(alice);
        vm.expectRevert(MockHtsToken.AmountExceedsTokenMaxSupply.selector);
        sauce.approve(address(router), SAUCE_MAX_SUPPLY + 1);

        // Alice spends SAUCE and buys WHBAR.
        router.associate(address(sauce));
        sauce.mint(alice, 3 * AMOUNT_PER_TICK);
        vm.prank(alice);
        sauce.approve(address(recurringBuy), 3 * AMOUNT_PER_TICK);
        RecurringBuy.PlanParams memory params = _params();
        (params.tokenIn, params.tokenOut) = (address(sauce), address(whbar));
        _start(alice, params, 3 * RESERVE);
        assertEq(sauce.allowance(address(recurringBuy), address(router)), SAUCE_MAX_SUPPLY);
        assertTrue(recurringBuy.tokenReady(address(sauce)));

        TickRun memory run = _runTick(1);
        _assertExecuted(run, 1, 1);
        assertEq(sauce.balanceOf(alice), 2 * AMOUNT_PER_TICK);
        assertEq(sauce.allowance(address(recurringBuy), address(router)), SAUCE_MAX_SUPPLY - AMOUNT_PER_TICK);
    }

    function test_RevertsWhenTheTokenServiceCannotDescribeTheInputToken() public {
        HTS.setResponseCode(INVALID_TOKEN_ID);
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.TokenInfoFailed.selector, address(whbar), INVALID_TOKEN_ID));
        _startPlan(alice);
        assertFalse(recurringBuy.tokenReady(address(whbar)));
    }

    function test_AcceptsATokenTheContractIsAlreadyAssociatedWith() public {
        // The contract's own association during start then answers 194, TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT.
        vm.prank(address(recurringBuy));
        whbar.associate();

        _startPlan(alice);
        assertEq(whbar.allowance(address(recurringBuy), address(router)), INT64_MAX);
    }

    function test_RejectsAnIncompletePlan() public {
        uint256 rescheduleGas = recurringBuy.RESCHEDULE_GAS();
        for (uint256 i; i < 8; i++) {
            RecurringBuy.PlanParams memory params = _params();
            if (i == 0) params.tokenIn = address(0);
            if (i == 1) params.tokenOut = address(0);
            if (i == 2) params.tokenOut = address(whbar);
            if (i == 3) params.amountPerTick = 0;
            if (i == 4) params.minAmountOut = 0;
            if (i == 5) params.period = 0;
            if (i == 6) params.tickGasLimit = 0;
            if (i == 7) params.tickGasLimit = uint64(rescheduleGas);
            vm.expectRevert(RecurringBuy.InvalidPlan.selector);
            _start(alice, params, RESERVE);
        }
    }

    function test_RejectsADepositThatCannotPayForTheFirstTick() public {
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.InsufficientGasDeposit.selector, RESERVE));
        _start(alice, _params(), RESERVE - 1);
    }

    function test_RevertsWhenHederaRefusesToScheduleTheFirstTick() public {
        HSS.setResponseCodes(INSUFFICIENT_PAYER_BALANCE, SUCCESS);
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.ScheduleCallFailed.selector, INSUFFICIENT_PAYER_BALANCE));
        _startPlan(alice);
        assertEq(recurringBuy.planCount(), 0);
    }

    // ---- scheduling ------------------------------------------------------------------------------------------

    function test_SchedulesTheFirstTickOnePeriodAheadWithThePlansGasLimit() public {
        vm.recordLogs();
        _startPlan(alice);
        uint256 expiry = block.timestamp + PERIOD;

        assertEq(HSS.callCount(), 1);
        MockScheduleService.ScheduledCall memory call = HSS.callAt(0);
        assertEq(call.to, address(recurringBuy));
        assertEq(call.expirySecond, expiry);
        assertEq(call.gasLimit, TICK_GAS_LIMIT);
        assertEq(call.value, 0);
        assertEq(call.callData, abi.encodeCall(RecurringBuy.tick, (1)));
        _assertScheduled(vm.getRecordedLogs(), 1, 1, call.schedule, expiry);

        RecurringBuy.Plan memory plan = recurringBuy.plans(1);
        assertEq(plan.nextSchedule, call.schedule);
        assertEq(plan.nextExpiry, expiry);
    }

    function test_MovesToALaterSecondWhenTheIdealOneHasNoCapacity() public {
        uint256 ideal = block.timestamp + PERIOD;
        HSS.setBusy(ideal, true);
        HSS.setBusy(ideal + 1, true);

        _startPlan(alice);
        assertEq(HSS.callAt(0).expirySecond, ideal + 2);
    }

    function test_GivesUpWhenTheIdealSecondAndTheProbedOnesAreAllFull() public {
        uint256 ideal = block.timestamp + PERIOD;
        uint256[6] memory delays = [uint256(0), 1, 2, 4, 8, 16];
        for (uint256 i; i < delays.length; i++) {
            HSS.setBusy(ideal + delays[i], true);
        }
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.ScheduleCallFailed.selector, SCHEDULE_EXPIRY_IS_BUSY));
        _startPlan(alice);
    }

    // ---- tick ------------------------------------------------------------------------------------------------

    function test_TickRunsOnlyWhenCalledByTheContractItself() public {
        _startPlan(alice);
        vm.prank(stranger);
        vm.expectRevert(RecurringBuy.OnlySelf.selector);
        recurringBuy.tick(1);
        vm.prank(alice);
        vm.expectRevert(RecurringBuy.OnlySelf.selector);
        recurringBuy.tick(1);
        vm.prank(stranger);
        vm.expectRevert(RecurringBuy.OnlySelf.selector);
        recurringBuy.buy(1);
    }

    function test_DoesNotWaitForTheExpirySecond() public {
        // On testnet block.timestamp inside a tick was one or two seconds before the scheduled second (B3).
        _startPlan(alice);
        _assertExecuted(_runTick(1, 2, TICK_GAS_PRICE), 1, 1);
    }

    function test_PullsOneSliceFromTheOwnerAndSwapsItToTheOwner() public {
        _startPlan(alice);
        uint256 whbarBefore = whbar.balanceOf(alice);

        _assertExecuted(_runTick(1), 1, 1);
        assertEq(whbar.balanceOf(alice), whbarBefore - AMOUNT_PER_TICK);
        assertEq(whbar.balanceOf(address(recurringBuy)), 0);
        assertEq(sauce.balanceOf(alice), SAUCE_PER_TICK);
        assertEq(router.lastPath(), abi.encodePacked(address(whbar), FEE, address(sauce)));
        assertEq(recurringBuy.plans(1).ticksDone, 1);
    }

    function test_SchedulesTheNextTickExactlyOnceAsItsLastExternalCall() public {
        _startPlan(alice);

        vm.startStateDiffRecording();
        TickRun memory run = _runTick(1);
        VmSafe.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        assertEq(_count(run.logs, address(recurringBuy), RecurringBuy.TickScheduled.selector), 1);
        assertEq(HSS.callCount(), 2);

        // buy() through a self-call, then hasScheduleCapacity, then scheduleCall - nothing after it.
        (VmSafe.AccountAccessKind[] memory kinds, address[] memory targets, uint256 n) = _callsMadeByTick(accesses);
        assertEq(n, 3);
        assertTrue(kinds[0] == VmSafe.AccountAccessKind.Call && targets[0] == address(recurringBuy));
        assertTrue(kinds[1] == VmSafe.AccountAccessKind.StaticCall && targets[1] == address(HSS));
        assertTrue(kinds[2] == VmSafe.AccountAccessKind.Call && targets[2] == address(HSS));
    }

    function test_SkipsATickBelowThePriceFloorTakesNothingAndKeepsThePlanGoing() public {
        _startPlan(alice);
        router.setRate(SAUCE_PER_TICK / 2, AMOUNT_PER_TICK);
        uint256 whbarBefore = whbar.balanceOf(alice);

        TickRun memory skipped = _runTick(1);
        _assertSkipped(skipped, 1, 1, abi.encodeWithSignature("Error(string)", "Too little received"));
        assertEq(_count(skipped.logs, address(recurringBuy), RecurringBuy.TickScheduled.selector), 1);
        assertEq(whbar.balanceOf(alice), whbarBefore);
        assertEq(sauce.balanceOf(alice), 0);
        assertTrue(recurringBuy.plans(1).active);

        router.setRate(SAUCE_PER_TICK, AMOUNT_PER_TICK);
        _assertExecuted(_runTick(1), 1, 2);
    }

    function test_CountsSkippedTicksTowardMaxTicks() public {
        _startPlanWith(alice, 2, 2 * RESERVE);
        router.setRate(SAUCE_PER_TICK / 2, AMOUNT_PER_TICK);

        _runTick(1);
        TickRun memory last = _runTick(1);
        _assertSkipped(last, 1, 2, abi.encodeWithSignature("Error(string)", "Too little received"));
        _assertStopped(last, 1, 2, RecurringBuy.StopReason.Completed, 0);
        assertEq(sauce.balanceOf(alice), 0);
    }

    function test_SkipsASwapThatRunsOutOfGasAndStillSchedulesTheNextTick() public {
        _startPlan(alice);
        router.setBurnGas(true);
        uint256 whbarBefore = whbar.balanceOf(alice);

        TickRun memory run = _runTick(1);
        _assertSkipped(run, 1, 1, "");
        assertEq(_count(run.logs, address(recurringBuy), RecurringBuy.TickScheduled.selector), 1);
        assertEq(whbar.balanceOf(alice), whbarBefore);
    }

    function test_SkipsTheTickWhenATokenOrPoolCallsBackIntoTheContract() public {
        // The router (standing in for a hostile pool) owns a plan and, mid-swap, tries to stop it: that would
        // refund the reservation of the tick that is running, which the network then bills to everyone else.
        router.associate(address(sauce));
        whbar.mint(address(router), 3 * AMOUNT_PER_TICK);
        router.execute(address(whbar), abi.encodeCall(MockHtsToken.approve, (address(recurringBuy), AMOUNT_PER_TICK)));
        vm.deal(address(router), 3 * RESERVE);
        router.execute{ value: 3 * RESERVE }(address(recurringBuy), abi.encodeCall(RecurringBuy.start, (_params())));
        assertEq(recurringBuy.plans(1).owner, address(router));
        router.setCallback(address(recurringBuy), abi.encodeCall(RecurringBuy.stop, (1, payable(stranger))));

        TickRun memory run = _runTick(1);
        _assertSkipped(run, 1, 1, abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(_count(run.logs, address(recurringBuy), RecurringBuy.TickScheduled.selector), 1);
        // The plan is still running and still holds its deposit: the callback stopped nothing and took nothing.
        RecurringBuy.Plan memory plan = recurringBuy.plans(1);
        assertTrue(plan.active);
        assertEq(plan.gasDeposit, 2 * RESERVE - _charge(run).amount);
    }

    function test_StopsThePlanWhenTheOwnerRevokesTheAllowance() public {
        _startPlan(alice);
        vm.prank(alice);
        whbar.approve(address(recurringBuy), 0);
        uint256 whbarBefore = whbar.balanceOf(alice);

        _assertStopped(_runTick(1), 1, 1, RecurringBuy.StopReason.PullFailed, 0);
        assertEq(whbar.balanceOf(alice), whbarBefore);
        assertEq(HSS.callCount(), 1);
        assertFalse(recurringBuy.plans(1).active);
    }

    function test_StopsThePlanWhenTheOwnersBalanceIsBelowOneSlice() public {
        _startPlan(alice);
        uint256 balance = whbar.balanceOf(alice);
        vm.prank(alice);
        assertTrue(whbar.transfer(bob, balance - AMOUNT_PER_TICK + 1));

        _assertStopped(_runTick(1), 1, 1, RecurringBuy.StopReason.PullFailed, 0);
        assertEq(HSS.callCount(), 1);
    }

    function test_StopsThePlanWhenTheTokenReturnsFalseInsteadOfReverting() public {
        _startPlan(alice);
        whbar.setQuietFailure(true);
        vm.prank(alice);
        whbar.approve(address(recurringBuy), 0);

        _assertStopped(_runTick(1), 1, 1, RecurringBuy.StopReason.PullFailed, 0);
    }

    function test_StopsAfterMaxTicksWithoutSchedulingAnotherTick() public {
        _startPlanWith(alice, 2, 2 * RESERVE);

        assertEq(_count(_runTick(1).logs, address(recurringBuy), RecurringBuy.TickScheduled.selector), 1);
        TickRun memory last = _runTick(1);
        _assertExecuted(last, 1, 2);
        _assertStopped(last, 1, 2, RecurringBuy.StopReason.Completed, 0);
        assertEq(_count(last.logs, address(recurringBuy), RecurringBuy.TickScheduled.selector), 0);

        assertEq(HSS.callCount(), 2);
        assertEq(sauce.balanceOf(alice), 2 * SAUCE_PER_TICK);
        RecurringBuy.Plan memory plan = recurringBuy.plans(1);
        assertFalse(plan.active);
        assertEq(plan.nextSchedule, address(0));
        assertEq(plan.nextExpiry, 0);
    }

    function test_StopsThePlanWhenHederaRefusesToScheduleTheNextTick() public {
        _startPlan(alice);
        HSS.setResponseCodes(INSUFFICIENT_PAYER_BALANCE, SUCCESS);

        TickRun memory run = _runTick(1);
        _assertExecuted(run, 1, 1);
        _assertStopped(run, 1, 1, RecurringBuy.StopReason.ScheduleFailed, INSUFFICIENT_PAYER_BALANCE);
        // Nothing was reserved for a second tick, and the first one's reservation is back less its cost.
        RecurringBuy.Plan memory plan = recurringBuy.plans(1);
        assertFalse(plan.active);
        assertEq(plan.gasDeposit, 3 * RESERVE - _charge(run).amount);
    }

    // ---- gas deposit -----------------------------------------------------------------------------------------

    function test_ChargesATickTheGasItUsedAtTheNetworksPriceAndReturnsTheRest() public {
        _startPlan(alice);

        TickRun memory run = _runTick(1);
        Charge memory charge = _charge(run);
        assertEq(charge.gasPrice, TICK_GAS_PRICE);
        _assertSettlementCovered(run, charge);

        // Three reservations came in: one went to tick 1 at start, one to tick 2 now, and tick 1's is back less
        // what the tick cost, which at half the reservation price is under half of it.
        assertLt(charge.amount, RESERVE / 2);
        assertEq(recurringBuy.plans(1).gasDeposit, 2 * RESERVE - charge.amount);
    }

    function test_ChargesASkippedTickTheSameWay() public {
        _startPlan(alice);
        router.setRate(SAUCE_PER_TICK / 2, AMOUNT_PER_TICK);

        TickRun memory run = _runTick(1);
        assertEq(_count(run.logs, address(recurringBuy), RecurringBuy.TickSkipped.selector), 1);
        Charge memory charge = _charge(run);
        assertEq(charge.gasPrice, TICK_GAS_PRICE);
        _assertSettlementCovered(run, charge);
        assertEq(recurringBuy.plans(1).gasDeposit, 2 * RESERVE - charge.amount);
    }

    function test_ChargesTheLastTickAndLeavesThePlanEverythingItsTicksDidNotCost() public {
        _startPlanWith(alice, 2, 2 * RESERVE);

        TickRun memory first = _runTick(1);
        assertEq(recurringBuy.plans(1).gasDeposit, RESERVE - _charge(first).amount);

        TickRun memory last = _runTick(1);
        _assertStopped(last, 1, 2, RecurringBuy.StopReason.Completed, 0);
        _assertSettlementCovered(last, _charge(last));

        uint256 leftover = 2 * RESERVE - _charge(first).amount - _charge(last).amount;
        assertEq(recurringBuy.plans(1).gasDeposit, leftover);
        uint256 aliceBefore = alice.balance;
        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.GasRefunded(1, alice, leftover);
        vm.prank(alice);
        recurringBuy.stop(1, payable(alice));
        assertEq(alice.balance, aliceBefore + leftover);

        // What stays in the contract is the part of the plan's charges the network did not bill.
        assertEq(
            address(recurringBuy).balance, _charge(first).amount + _charge(last).amount - first.billed - last.billed
        );
    }

    function test_CoversTheSettlementOfALastTickThatFindsTheDepositEmpty() public {
        _startPlanWith(alice, 1, RESERVE);
        assertEq(recurringBuy.plans(1).gasDeposit, 0);

        // Writing to an empty storage slot is the dearest thing a tick can do after it has measured itself.
        TickRun memory run = _runTick(1);
        Charge memory charge = _charge(run);
        _assertSettlementCovered(run, charge);
        assertEq(recurringBuy.plans(1).gasDeposit, RESERVE - charge.amount);
    }

    function test_ChargesTheTickThatEndsAPlanOnAFailedPull() public {
        _startPlan(alice);
        vm.prank(alice);
        whbar.approve(address(recurringBuy), 0);

        TickRun memory run = _runTick(1);
        _assertStopped(run, 1, 1, RecurringBuy.StopReason.PullFailed, 0);
        Charge memory charge = _charge(run);
        _assertSettlementCovered(run, charge);
        assertEq(recurringBuy.plans(1).gasDeposit, 3 * RESERVE - charge.amount);
    }

    function test_NeverChargesATickAboveItsReservation() public {
        _startPlan(alice);

        // A gas price over the reserve price counts as the reserve price.
        Charge memory charge = _charge(_runTick(1, 0, 3 * RESERVE_GAS_PRICE));
        assertEq(charge.gasPrice, RESERVE_GAS_PRICE);
        assertLt(charge.amount, RESERVE);
        assertEq(recurringBuy.plans(1).gasDeposit, 2 * RESERVE - charge.amount);
    }

    function test_ChargesAtTheReservePriceWhenTheNetworkReportsNoGasPrice() public {
        _startPlan(alice);

        Charge memory charge = _charge(_runTick(1, 0, 0));
        assertEq(charge.gasPrice, RESERVE_GAS_PRICE);
        assertEq(recurringBuy.plans(1).gasDeposit, 2 * RESERVE - charge.amount);
    }

    function test_NeverSpendsOnePlansDepositOnAnotherPlansTicks() public {
        uint256 planA = _startPlanWith(alice, 0, 2 * RESERVE);
        uint256 planB = _startPlanWith(bob, 0, 5 * RESERVE);
        uint256 balanceBefore = address(recurringBuy).balance;
        assertEq(_owedToPlans(), balanceBefore);

        TickRun memory first = _runTick(planA);
        assertEq(_count(first.logs, address(recurringBuy), RecurringBuy.TickScheduled.selector), 1);
        assertEq(recurringBuy.plans(planA).gasDeposit, RESERVE - _charge(first).amount);

        // What is left of plan A's deposit cannot reserve a third tick, so its second tick is its last.
        uint256 callsBefore = HSS.callCount();
        TickRun memory exhausted = _runTick(planA);
        _assertExecuted(exhausted, planA, 2);
        _assertStopped(exhausted, planA, 2, RecurringBuy.StopReason.GasDepositExhausted, 0);
        assertEq(HSS.callCount(), callsBefore);

        // The network billed plan A's two ticks to the contract. Plan A paid for them, so the contract still holds
        // everything it owes: A's leftover, B's deposit and B's pending reservation.
        uint256 billed = first.billed + exhausted.billed;
        assertGt(billed, 0);
        assertEq(address(recurringBuy).balance, balanceBefore - billed);
        assertGe(_charge(first).amount + _charge(exhausted).amount, billed);
        assertEq(recurringBuy.plans(planA).gasDeposit, 2 * RESERVE - _charge(first).amount - _charge(exhausted).amount);
        assertEq(recurringBuy.plans(planB).gasDeposit, 4 * RESERVE);
        assertGe(address(recurringBuy).balance, _owedToPlans());

        TickRun memory tickB = _runTick(planB);
        _assertScheduled(tickB.logs, planB, 2);
        assertEq(recurringBuy.plans(planB).gasDeposit, 4 * RESERVE - _charge(tickB).amount);
        assertGe(address(recurringBuy).balance, _owedToPlans());
    }

    function test_LetsAnyoneTopUpARunningPlanAndOnlyARunningOne() public {
        uint256 planId = _startPlanWith(alice, 0, RESERVE);
        assertEq(recurringBuy.plans(planId).gasDeposit, 0);

        vm.deal(stranger, 2 * RESERVE);
        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.GasDepositAdded(planId, RESERVE);
        vm.prank(stranger);
        recurringBuy.topUp{ value: RESERVE }(planId);
        _assertScheduled(_runTick(planId).logs, planId, 2);

        vm.prank(alice);
        recurringBuy.stop(planId, payable(alice));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.PlanNotActive.selector, planId));
        recurringBuy.topUp{ value: RESERVE }(planId);
    }

    // ---- stop ------------------------------------------------------------------------------------------------

    function test_RefundsTheWholeDepositWhenHederaDeletesThePendingTicksSchedule() public {
        _startPlanWith(alice, 0, 3 * RESERVE);
        address pending = recurringBuy.plans(1).nextSchedule;
        uint256 aliceBefore = alice.balance;

        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.PlanStopped(1, 0, RecurringBuy.StopReason.StoppedByOwner, SUCCESS);
        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.GasRefunded(1, alice, 3 * RESERVE);
        vm.prank(alice);
        recurringBuy.stop(1, payable(alice));

        assertEq(alice.balance, aliceBefore + 3 * RESERVE);
        assertEq(address(recurringBuy).balance, 0);
        assertEq(HSS.lastDeleted(), pending);
        RecurringBuy.Plan memory plan = recurringBuy.plans(1);
        assertFalse(plan.active);
        assertEq(plan.nextSchedule, address(0));
    }

    function test_KeepsThePendingTicksReservationWhenItsScheduleCannotBeDeleted() public {
        _startPlanWith(alice, 0, 3 * RESERVE);
        HSS.setResponseCodes(SUCCESS, INVALID_SCHEDULE_ID);
        uint256 aliceBefore = alice.balance;

        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.PlanStopped(1, 0, RecurringBuy.StopReason.StoppedByOwner, INVALID_SCHEDULE_ID);
        vm.prank(alice);
        recurringBuy.stop(1, payable(alice));
        assertEq(alice.balance, aliceBefore + 2 * RESERVE);

        // That tick then reverts.
        TickRun memory run = _runTick(1);
        assertFalse(run.success);
        assertEq(run.revertData, abi.encodeWithSelector(RecurringBuy.PlanNotActive.selector, 1));
    }

    function test_RefundsTheDepositAndThePendingReservationAfterTicksHaveRun() public {
        _startPlanWith(alice, 0, 3 * RESERVE);
        TickRun memory run = _runTick(1);
        uint256 charged = _charge(run).amount;
        uint256 aliceBefore = alice.balance;

        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.GasRefunded(1, alice, 3 * RESERVE - charged);
        vm.prank(alice);
        recurringBuy.stop(1, payable(alice));
        assertEq(alice.balance, aliceBefore + 3 * RESERVE - charged);
        assertEq(address(recurringBuy).balance, charged - run.billed);
    }

    function test_ReturnsWhatIsLeftOfTheDepositOfAPlanThatEndedByItself() public {
        _startPlanWith(alice, 0, 3 * RESERVE);
        vm.prank(alice);
        whbar.approve(address(recurringBuy), 0);
        uint256 charged = _charge(_runTick(1)).amount;

        vm.recordLogs();
        vm.prank(alice);
        recurringBuy.stop(1, payable(alice));
        VmSafe.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_count(logs, address(recurringBuy), RecurringBuy.PlanStopped.selector), 0);
        VmSafe.Log memory refunded = _only(logs, RecurringBuy.GasRefunded.selector);
        assertEq(abi.decode(refunded.data, (uint256)), 3 * RESERVE - charged);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.NothingToRefund.selector, 1));
        recurringBuy.stop(1, payable(alice));
    }

    function test_LetsOnlyTheOwnerStopAPlanAndTakeItsDeposit() public {
        _startPlanWith(alice, 0, 3 * RESERVE);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.NotPlanOwner.selector, 1));
        recurringBuy.stop(1, payable(stranger));
        RecurringBuy.Plan memory plan = recurringBuy.plans(1);
        assertTrue(plan.active);
        assertEq(plan.gasDeposit, 2 * RESERVE);
    }

    function test_SendsTheRefundWhereTheOwnerAsksAndStopsNothingIfThatAddressRefusesHbar() public {
        _startPlanWith(alice, 0, 3 * RESERVE);

        // A contract with no receive function (here the token) cannot take the refund.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RecurringBuy.RefundFailed.selector, 1));
        recurringBuy.stop(1, payable(address(whbar)));
        assertTrue(recurringBuy.plans(1).active);

        uint256 bobBefore = bob.balance;
        vm.expectEmit(address(recurringBuy));
        emit RecurringBuy.GasRefunded(1, bob, 3 * RESERVE);
        vm.prank(alice);
        recurringBuy.stop(1, payable(bob));
        assertEq(bob.balance, bobBefore + 3 * RESERVE);
    }

    // ---- helpers ---------------------------------------------------------------------------------------------

    function _params() private view returns (RecurringBuy.PlanParams memory) {
        return RecurringBuy.PlanParams({
            tokenIn: address(whbar),
            fee: FEE,
            tokenOut: address(sauce),
            amountPerTick: AMOUNT_PER_TICK,
            minAmountOut: MIN_AMOUNT_OUT,
            period: PERIOD,
            maxTicks: 0,
            tickGasLimit: TICK_GAS_LIMIT
        });
    }

    function _start(address user, RecurringBuy.PlanParams memory params, uint256 deposit) private returns (uint256) {
        vm.prank(user);
        return recurringBuy.start{ value: deposit }(params);
    }

    function _startPlan(address user) private returns (uint256) {
        return _start(user, _params(), 3 * RESERVE);
    }

    function _startPlanWith(address user, uint64 maxTicks, uint256 deposit) private returns (uint256) {
        RecurringBuy.PlanParams memory params = _params();
        params.maxTicks = maxTicks;
        return _start(user, params, deposit);
    }

    function _runTick(uint256 planId) private returns (TickRun memory) {
        return _runTick(planId, 0, TICK_GAS_PRICE);
    }

    /// Does what Hedera does at a schedule's expiry second: sends the latest call scheduled for `planId` from the
    /// contract that scheduled it, with the scheduled gas limit, and takes the gas it used at `gasPrice` from that
    /// contract's balance. `early` runs it that many seconds before the second.
    function _runTick(uint256 planId, uint256 early, uint256 gasPrice) private returns (TickRun memory run) {
        bytes memory tickData = abi.encodeCall(RecurringBuy.tick, (planId));
        for (uint256 i = HSS.callCount(); i > 0; i--) {
            MockScheduleService.ScheduledCall memory call = HSS.callAt(i - 1);
            if (call.responseCode != SUCCESS || keccak256(call.callData) != keccak256(tickData)) continue;
            vm.warp(call.expirySecond - early);
            vm.txGasPrice(gasPrice);
            vm.recordLogs();
            vm.prank(call.to);
            (run.success, run.revertData) = call.to.call{ gas: call.gasLimit }(call.callData);
            run.gasUsed = vm.lastCallGas().gasTotalUsed;
            run.logs = vm.getRecordedLogs();
            run.billed = run.gasUsed * gasPrice;
            vm.deal(call.to, call.to.balance - run.billed);
            return run;
        }
        revert("no tick scheduled for this plan");
    }

    /// What a tick charged its plan: its TickCharged event.
    function _charge(TickRun memory run) private view returns (Charge memory charge) {
        (, charge.gasCharged, charge.gasPrice) =
            abi.decode(_only(run.logs, RecurringBuy.TickCharged.selector).data, (uint64, uint256, uint256));
        charge.amount = charge.gasCharged * charge.gasPrice;
    }

    /// The tick measures the gas gone so far, then adds SETTLEMENT_GAS for what it still does. The call used no more
    /// than that in all, and measured after everything but the settlement: at most SETTLEMENT_GAS came after.
    function _assertSettlementCovered(TickRun memory run, Charge memory charge) private view {
        uint256 settlementGas = recurringBuy.SETTLEMENT_GAS();
        assertGe(charge.gasCharged, run.gasUsed, "the tick used more gas than it charged");
        assertLe(charge.gasCharged - settlementGas, run.gasUsed, "the tick measured itself after it ended");
    }

    /// HBAR the contract owes its plans: every deposit, plus the reservation of every pending tick.
    function _owedToPlans() private view returns (uint256 owed) {
        for (uint256 planId = 1; planId <= recurringBuy.planCount(); planId++) {
            RecurringBuy.Plan memory plan = recurringBuy.plans(planId);
            owed += plan.gasDeposit + (plan.active ? RESERVE : 0);
        }
    }

    /// The first `n` entries are the calls a tick's own frame made, in order: kind and target.
    function _callsMadeByTick(VmSafe.AccountAccess[] memory accesses)
        private
        view
        returns (VmSafe.AccountAccessKind[] memory kinds, address[] memory targets, uint256 n)
    {
        uint256 tickDepth = type(uint256).max;
        kinds = new VmSafe.AccountAccessKind[](accesses.length);
        targets = new address[](accesses.length);
        for (uint256 i; i < accesses.length; i++) {
            VmSafe.AccountAccess memory access = accesses[i];
            bool isCall =
                access.kind == VmSafe.AccountAccessKind.Call || access.kind == VmSafe.AccountAccessKind.StaticCall;
            if (!isCall) continue;
            if (tickDepth == type(uint256).max) {
                if (access.account == address(recurringBuy) && bytes4(access.data) == RecurringBuy.tick.selector) {
                    tickDepth = access.depth;
                }
            } else if (access.depth == tickDepth + 1 && access.accessor == address(recurringBuy)) {
                (kinds[n], targets[n]) = (access.kind, access.account);
                n++;
            }
        }
        assertTrue(tickDepth != type(uint256).max, "no tick in the recording");
    }

    function _assertExecuted(TickRun memory run, uint256 planId, uint64 tickNumber) private view {
        VmSafe.Log memory log = _only(run.logs, RecurringBuy.TickExecuted.selector);
        assertEq(log.topics[1], bytes32(planId));
        assertEq(log.data, abi.encode(tickNumber, AMOUNT_PER_TICK, SAUCE_PER_TICK));
    }

    function _assertSkipped(TickRun memory run, uint256 planId, uint64 tickNumber, bytes memory reason) private view {
        VmSafe.Log memory log = _only(run.logs, RecurringBuy.TickSkipped.selector);
        assertEq(log.topics[1], bytes32(planId));
        assertEq(log.data, abi.encode(tickNumber, reason));
    }

    function _assertStopped(
        TickRun memory run,
        uint256 planId,
        uint64 ticksDone,
        RecurringBuy.StopReason reason,
        int64 responseCode
    ) private view {
        VmSafe.Log memory log = _only(run.logs, RecurringBuy.PlanStopped.selector);
        assertEq(log.topics[1], bytes32(planId));
        assertEq(log.data, abi.encode(ticksDone, reason, responseCode));
    }

    function _assertScheduled(VmSafe.Log[] memory logs, uint256 planId, uint64 tickNumber) private view {
        VmSafe.Log memory log = _only(logs, RecurringBuy.TickScheduled.selector);
        assertEq(log.topics[1], bytes32(planId));
        (uint64 number,,) = abi.decode(log.data, (uint64, address, uint256));
        assertEq(number, tickNumber);
    }

    function _assertScheduled(
        VmSafe.Log[] memory logs,
        uint256 planId,
        uint64 tickNumber,
        address schedule,
        uint256 expiry
    ) private view {
        VmSafe.Log memory log = _only(logs, RecurringBuy.TickScheduled.selector);
        assertEq(log.topics[1], bytes32(planId));
        assertEq(log.data, abi.encode(tickNumber, schedule, expiry));
    }

    /// The one event of `selector` that the contract emitted.
    function _only(VmSafe.Log[] memory logs, bytes32 selector) private view returns (VmSafe.Log memory found) {
        assertEq(_count(logs, address(recurringBuy), selector), 1, "expected exactly one such event");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(recurringBuy) && logs[i].topics[0] == selector) found = logs[i];
        }
    }

    function _count(VmSafe.Log[] memory logs, address emitter, bytes32 selector) private pure returns (uint256 n) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == selector) n++;
        }
    }
}
