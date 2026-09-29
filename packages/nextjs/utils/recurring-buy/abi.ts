import { parseAbi } from "viem";

/**
 * The part of packages/hardhat/contracts/RecurringBuy.sol the app calls and reads. It is written out here, not taken
 * from deployedContracts.ts, because the app must also read a RecurringBuy it did not deploy (the reference plan) and
 * must build before any deployment exists. abi.test.ts compares it with the compiled artifact.
 */
export const recurringBuyAbi = parseAbi([
  "struct PlanParams { address tokenIn; uint24 fee; address tokenOut; uint256 amountPerTick; uint256 minAmountOut; uint64 period; uint64 maxTicks; uint64 tickGasLimit; }",
  "struct Plan { address owner; uint64 ticksDone; bool active; uint24 fee; address tokenIn; uint64 maxTicks; address tokenOut; uint64 period; address nextSchedule; uint64 nextExpiry; uint64 tickGasLimit; uint256 amountPerTick; uint256 minAmountOut; uint256 gasDeposit; }",
  "function start(PlanParams params) payable returns (uint256 planId)",
  "function stop(uint256 planId, address refundTo)",
  "function plans(uint256 planId) view returns (Plan)",
  "function reserveGasPrice() view returns (uint256)",
  "function RESCHEDULE_GAS() view returns (uint256)",
  "function tokenReady(address token) view returns (bool)",
  "event PlanCreated(uint256 indexed planId, address indexed owner, PlanParams params, uint256 deposit)",
  "event TickScheduled(uint256 indexed planId, uint64 tickNumber, address schedule, uint256 expirySecond)",
  "event TickExecuted(uint256 indexed planId, uint64 tickNumber, uint256 amountIn, uint256 amountOut)",
  "event TickSkipped(uint256 indexed planId, uint64 tickNumber, bytes reason)",
  "event PlanStopped(uint256 indexed planId, uint64 ticksDone, uint8 reason, int64 hssResponseCode)",
  "event GasDepositAdded(uint256 indexed planId, uint256 amount)",
  "event GasRefunded(uint256 indexed planId, address indexed to, uint256 amount)",
  "error InvalidPlan()",
  "error InsufficientGasDeposit(uint256 required)",
  "error AssociationFailed(address token, int64 responseCode)",
  "error RouterApprovalFailed(address token)",
  "error ScheduleCallFailed(int64 responseCode)",
  "error OnlySelf()",
  "error PullFailed()",
  "error PlanNotActive(uint256 planId)",
  "error NotPlanOwner(uint256 planId)",
  "error NothingToRefund(uint256 planId)",
  "error RefundFailed(uint256 planId)",
]);

/** RecurringBuy.StopReason, in declaration order. */
export const STOP_REASONS = [
  "Completed",
  "StoppedByOwner",
  "PullFailed",
  "GasDepositExhausted",
  "ScheduleFailed",
] as const;

export type StopReason = (typeof STOP_REASONS)[number];
