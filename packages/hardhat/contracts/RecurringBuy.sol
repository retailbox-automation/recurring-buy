// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IHederaScheduleService } from "./interfaces/IHederaScheduleService.sol";
import { IHRC719 } from "./interfaces/IHRC719.sol";
import { ISaucerSwapV2Router } from "./interfaces/ISaucerSwapV2Router.sol";

/// @title RecurringBuy
/// @notice Recurring buys (dollar-cost averaging) on SaucerSwap V2 with no keeper bot. The owner's tokens
/// stay in the owner's wallet: the contract may take one slice per tick under an HTS allowance (HIP-376)
/// that the owner sets and can revoke. Once per period the Hedera Schedule Service (HIP-1215) runs `tick`,
/// which pulls the slice, swaps it on SaucerSwap with the owner as recipient, and schedules the next tick.
///
/// @dev When a tick fails:
/// - the swap reverts (below the plan's price floor, or any other router error): the tick is skipped,
///   nothing is taken, and the next tick is scheduled. The plan never buys below its floor.
/// - the slice cannot be pulled (allowance revoked or too low, balance too low): the plan stops.
/// Both run inside a self-call under try/catch: an uncaught revert would also undo the next schedule,
/// and the plan would look active with nothing left to run it. The self-call gets all the tick's gas
/// except RESCHEDULE_GAS, so a swap that runs out of gas is skipped like any other failed swap.
/// Tokens and pools are external code; `nonReentrant` keeps them from calling back into a plan mid-tick.
///
/// Gas deposit: Hedera charges every scheduled tick to this contract, the schedule's payer, so all plans
/// pay from one balance. Each plan therefore pre-pays its own ticks. Scheduling a tick moves
/// `tickGasLimit * reserveGasPrice` out of the plan's deposit: the most the network can charge for that
/// tick while its gas price stays at or below `reserveGasPrice`. The network charges less (the gas the
/// tick used, at the current price), and the difference stays in the contract as a shared buffer against
/// gas price rises; it is not paid out. A plan whose deposit cannot cover the next reservation stops.
contract RecurringBuy is ReentrancyGuard {
    /// @notice Parameters of a new plan. The path is single-hop: tokenIn -> (pool fee) -> tokenOut.
    struct PlanParams {
        address tokenIn;
        uint24 fee; // pool fee in hundredths of a bip, e.g. 3000 = 0.3%
        address tokenOut;
        uint256 amountPerTick; // in tokenIn's smallest unit
        uint256 minAmountOut; // price floor: least tokenOut accepted for one slice
        uint64 period; // seconds between ticks
        uint64 maxTicks; // ticks to run, skipped ones included; 0 = until stopped
        uint64 tickGasLimit; // gas for one tick: pull, swap and the next schedule; above RESCHEDULE_GAS
    }

    struct Plan {
        address owner;
        uint64 ticksDone; // ticks run: bought, skipped, or ended by a failed pull
        bool active;
        uint24 fee;
        address tokenIn;
        uint64 maxTicks;
        address tokenOut;
        uint64 period;
        address nextSchedule; // the pending tick's schedule
        uint64 nextExpiry; // and the second it is due
        uint64 tickGasLimit;
        uint256 amountPerTick;
        uint256 minAmountOut;
        uint256 gasDeposit; // HBAR not yet reserved for a tick
    }

    enum StopReason {
        Completed,
        StoppedByOwner,
        PullFailed,
        GasDepositExhausted,
        ScheduleFailed
    }

    IHederaScheduleService private constant HSS = IHederaScheduleService(address(0x16b));
    int64 private constant SUCCESS = 22;
    int64 private constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;
    /// HTS token amounts are int64.
    uint256 private constant HTS_MAX_AMOUNT = uint256(uint64(type(int64).max));
    /// How far past a full second to look for one with capacity: 1, 2, 4, 8, 16 s.
    uint256 private constant MAX_CAPACITY_DELAY = 16;

    /// @notice Gas a tick keeps back from the swap for scheduling the next tick. On testnet scheduleCall
    /// took 1.41M gas; the rest covers the capacity probes and the bookkeeping after the swap.
    uint256 public constant RESCHEDULE_GAS = 1_600_000;

    /// @notice The SaucerSwap V2 router every plan swaps through.
    ISaucerSwapV2Router public immutable router;
    /// @notice HBAR reserved per unit of tick gas, in the EVM's native unit (tinybar on Hedera). Set it
    /// comfortably above the network gas price (eth_gasPrice / 1e10), e.g. twice.
    uint256 public immutable reserveGasPrice;

    /// @notice Number of plans ever started; plan ids run from 1 to planCount.
    uint256 public planCount;
    /// @notice Whether this contract is associated with `token` and has approved the router for it.
    mapping(address token => bool) public tokenReady;
    mapping(uint256 planId => Plan) private _plans;

    event PlanCreated(uint256 indexed planId, address indexed owner, PlanParams params, uint256 deposit);
    event TickScheduled(uint256 indexed planId, uint64 tickNumber, address schedule, uint256 expirySecond);
    event TickExecuted(uint256 indexed planId, uint64 tickNumber, uint256 amountIn, uint256 amountOut);
    /// @param reason The router's revert data, e.g. Error("Too little received") below the price floor.
    event TickSkipped(uint256 indexed planId, uint64 tickNumber, bytes reason);
    /// @param hssResponseCode The Hedera Schedule Service response behind the stop: scheduleCall's for
    /// ScheduleFailed, deleteSchedule's for StoppedByOwner (22 = the pending tick was deleted), else 0.
    event PlanStopped(uint256 indexed planId, uint64 ticksDone, StopReason reason, int64 hssResponseCode);
    event GasDepositAdded(uint256 indexed planId, uint256 amount);
    event GasRefunded(uint256 indexed planId, address indexed to, uint256 amount);

    error InvalidConfig();
    error InvalidPlan();
    error InsufficientGasDeposit(uint256 required);
    error AssociationFailed(address token, int64 responseCode);
    error RouterApprovalFailed(address token);
    error ScheduleCallFailed(int64 responseCode);
    error OnlySelf();
    error PullFailed();
    error PlanNotActive(uint256 planId);
    error NotPlanOwner(uint256 planId);
    error NothingToRefund(uint256 planId);
    error RefundFailed(uint256 planId);

    constructor(ISaucerSwapV2Router router_, uint256 reserveGasPrice_) {
        if (address(router_) == address(0) || reserveGasPrice_ == 0) revert InvalidConfig();
        router = router_;
        reserveGasPrice = reserveGasPrice_;
    }

    /// @notice Starts a plan for the caller and schedules its first tick one period from now.
    /// Before the first tick the caller approves this contract on `tokenIn` (an HTS allowance; the total
    /// it allows caps what the plan can ever spend) and associates with `tokenOut`. The allowance belongs
    /// to the owner and the token, so plans of one owner on the same `tokenIn` share it, and revoking it
    /// stops all of them.
    /// @dev The first plan for a `tokenIn` also associates this contract with it (HIP-719) and approves
    /// the router, which costs roughly 1.4M gas once.
    /// @param params See PlanParams. `minAmountOut` must be non-zero: a plan always has a price floor.
    /// @return planId The new plan's id.
    function start(PlanParams calldata params) external payable nonReentrant returns (uint256 planId) {
        if (
            params.tokenIn == address(0) ||
            params.tokenOut == address(0) ||
            params.tokenIn == params.tokenOut ||
            params.amountPerTick == 0 ||
            params.minAmountOut == 0 ||
            params.period == 0 ||
            params.tickGasLimit <= RESCHEDULE_GAS
        ) revert InvalidPlan();
        uint256 reserve = params.tickGasLimit * reserveGasPrice;
        if (msg.value < reserve) revert InsufficientGasDeposit(reserve);
        _prepareToken(params.tokenIn);

        planId = ++planCount;
        Plan storage plan = _plans[planId];
        plan.owner = msg.sender;
        plan.active = true;
        plan.fee = params.fee;
        plan.tokenIn = params.tokenIn;
        plan.maxTicks = params.maxTicks;
        plan.tokenOut = params.tokenOut;
        plan.period = params.period;
        plan.tickGasLimit = params.tickGasLimit;
        plan.amountPerTick = params.amountPerTick;
        plan.minAmountOut = params.minAmountOut;
        plan.gasDeposit = msg.value;
        emit PlanCreated(planId, msg.sender, params, msg.value);

        int64 responseCode = _scheduleTick(planId, plan);
        if (responseCode != SUCCESS) revert ScheduleCallFailed(responseCode);
    }

    /// @notice Runs the plan's next tick. Only the Hedera Schedule Service calls it, as this contract:
    /// the schedule's payer is its sender.
    /// @dev No time check: on testnet a scheduled tick saw block.timestamp one or two seconds before its
    /// expiry second, so a `block.timestamp >= expiry` guard would reject it. The sender check is enough,
    /// since nothing else can make this contract call `tick`.
    function tick(uint256 planId) external nonReentrant {
        if (msg.sender != address(this)) revert OnlySelf();
        Plan storage plan = _plans[planId];
        if (!plan.active) revert PlanNotActive(planId);
        uint64 tickNumber = ++plan.ticksDone;

        uint256 gasLeft = gasleft();
        uint256 buyGas = gasLeft > RESCHEDULE_GAS ? gasLeft - RESCHEDULE_GAS : 0;
        try this.buy{ gas: buyGas }(planId) returns (uint256 amountOut) {
            emit TickExecuted(planId, tickNumber, plan.amountPerTick, amountOut);
        } catch (bytes memory reason) {
            if (bytes4(reason) == PullFailed.selector) {
                _end(planId, plan, StopReason.PullFailed, 0);
                return;
            }
            emit TickSkipped(planId, tickNumber, reason);
        }

        if (tickNumber == plan.maxTicks) {
            _end(planId, plan, StopReason.Completed, 0);
        } else if (plan.gasDeposit < _reserve(plan)) {
            _end(planId, plan, StopReason.GasDepositExhausted, 0);
        } else {
            // The last scheduling call of this execution: a schedule after a recursive one fails with
            // NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION (373).
            int64 responseCode = _scheduleTick(planId, plan);
            if (responseCode != SUCCESS) _end(planId, plan, StopReason.ScheduleFailed, responseCode);
        }
    }

    /// @notice One slice of a tick: pull `amountPerTick` from the owner and swap it to the owner.
    /// Only this contract calls it, from `tick`, so that any revert in here undoes both steps and `tick`
    /// can tell a failed pull (PullFailed) from a failed swap (anything else).
    /// @return amountOut tokenOut the owner received.
    function buy(uint256 planId) external returns (uint256 amountOut) {
        if (msg.sender != address(this)) revert OnlySelf();
        Plan storage plan = _plans[planId];
        // The HTS facade reverts without data when the allowance or the balance is short.
        try IERC20(plan.tokenIn).transferFrom(plan.owner, address(this), plan.amountPerTick) returns (bool pulled) {
            if (!pulled) revert PullFailed();
        } catch {
            revert PullFailed();
        }
        amountOut = router.exactInput(
            ISaucerSwapV2Router.ExactInputParams({
                path: abi.encodePacked(plan.tokenIn, plan.fee, plan.tokenOut),
                recipient: plan.owner,
                deadline: block.timestamp,
                amountIn: plan.amountPerTick,
                amountOutMinimum: plan.minAmountOut
            })
        );
    }

    /// @notice Adds HBAR to a running plan's gas deposit, e.g. to keep a plan without maxTicks going.
    /// Anyone may pay; the deposit still only returns to the plan's owner.
    function topUp(uint256 planId) external payable nonReentrant {
        Plan storage plan = _plans[planId];
        if (!plan.active) revert PlanNotActive(planId);
        plan.gasDeposit += msg.value;
        emit GasDepositAdded(planId, msg.value);
    }

    /// @notice Stops a running plan and sends what is left of its gas deposit to `refundTo`. On a plan
    /// that already ended by itself (completed, pull failed, deposit used up) it only returns the leftover.
    /// If `refundTo` does not accept HBAR the whole call reverts; try again with another address.
    /// Revoking the allowance (`approve(0)` on tokenIn) also stops the spending, with no call to this
    /// contract: the next tick fails to pull and ends the plan.
    /// @dev Also deletes the pending tick's schedule (HIP-1215 deleteSchedule). If Hedera confirms (22),
    /// that tick's reservation is refunded too. If not, the reservation stays to pay for the pending tick,
    /// which then reverts with PlanNotActive.
    function stop(uint256 planId, address payable refundTo) external nonReentrant {
        Plan storage plan = _plans[planId];
        if (msg.sender != plan.owner) revert NotPlanOwner(planId);
        if (plan.active) {
            int64 responseCode = HSS.deleteSchedule(plan.nextSchedule);
            if (responseCode == SUCCESS) plan.gasDeposit += _reserve(plan);
            _end(planId, plan, StopReason.StoppedByOwner, responseCode);
        } else if (plan.gasDeposit == 0) {
            revert NothingToRefund(planId);
        }

        uint256 refund = plan.gasDeposit;
        if (refund == 0) return;
        plan.gasDeposit = 0;
        (bool sent, ) = refundTo.call{ value: refund }("");
        if (!sent) revert RefundFailed(planId);
        emit GasRefunded(planId, refundTo, refund);
    }

    /// @notice A plan's full state, including the pending tick (`nextSchedule`, `nextExpiry`). An active
    /// plan whose `nextExpiry` is well in the past has stalled (its tick ran out of gas); `stop` recovers
    /// the deposit.
    function plans(uint256 planId) external view returns (Plan memory) {
        return _plans[planId];
    }

    function _prepareToken(address token) private {
        if (tokenReady[token]) return;
        int64 responseCode = IHRC719(token).associate();
        if (responseCode != SUCCESS && responseCode != TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT) {
            revert AssociationFailed(token, responseCode);
        }
        // The contract holds a slice only between the pull and the swap, so a standing allowance is safe.
        if (!IERC20(token).approve(address(router), HTS_MAX_AMOUNT)) revert RouterApprovalFailed(token);
        tokenReady[token] = true;
    }

    /// @dev Schedules tick(planId) one period from now, or at the first later second with capacity, and
    /// reserves its gas from the plan's deposit. Returns the HSS response code; 22 on success.
    function _scheduleTick(uint256 planId, Plan storage plan) private returns (int64 responseCode) {
        uint256 expiry = _secondWithCapacity(block.timestamp + plan.period, plan.tickGasLimit);
        address schedule;
        (responseCode, schedule) = HSS.scheduleCall(
            address(this),
            expiry,
            plan.tickGasLimit,
            0,
            abi.encodeCall(this.tick, (planId))
        );
        if (responseCode != SUCCESS) return responseCode;
        plan.gasDeposit -= _reserve(plan);
        plan.nextSchedule = schedule;
        plan.nextExpiry = uint64(expiry);
        emit TickScheduled(planId, plan.ticksDone + 1, schedule, expiry);
    }

    /// @dev HIP-1215's suggested probe for a busy second, without its jitter. If no second has capacity
    /// this returns `ideal`, and scheduleCall reports SCHEDULE_EXPIRY_IS_BUSY (370).
    function _secondWithCapacity(uint256 ideal, uint256 gasLimit) private view returns (uint256) {
        if (HSS.hasScheduleCapacity(ideal, gasLimit)) return ideal;
        for (uint256 delay = 1; delay <= MAX_CAPACITY_DELAY; delay *= 2) {
            if (HSS.hasScheduleCapacity(ideal + delay, gasLimit)) return ideal + delay;
        }
        return ideal;
    }

    function _reserve(Plan storage plan) private view returns (uint256) {
        return plan.tickGasLimit * reserveGasPrice;
    }

    function _end(uint256 planId, Plan storage plan, StopReason reason, int64 hssResponseCode) private {
        plan.active = false;
        plan.nextSchedule = address(0);
        plan.nextExpiry = 0;
        emit PlanStopped(planId, plan.ticksDone, reason, hssResponseCode);
    }
}
