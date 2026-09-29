import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

import type { MockScheduleService } from "../typechain-types";

const HSS = ethers.getAddress("0x000000000000000000000000000000000000016b");

// HAPI response codes (ResponseCodeEnum ordinals).
const SUCCESS = 22n;
const INSUFFICIENT_PAYER_BALANCE = 10n;
const INVALID_SCHEDULE_ID = 201n;
const SCHEDULE_EXPIRY_IS_BUSY = 370n;

const INT64_MAX = 2n ** 63n - 1n;

// A daily buy of 0.05 WHBAR (8 decimals) for SAUCE (6 decimals) with a 95% price floor. The rate is what
// the testnet WHBAR/SAUCE pool (fee 0.3%) paid for 0.05 WHBAR in a live run.
const FEE = 3000;
const AMOUNT_PER_TICK = 5_000_000n;
const SAUCE_PER_TICK = 2_046_098n;
const MIN_AMOUNT_OUT = 1_943_793n;
const PERIOD = 86_400n;

// A tick that pulls, swaps and reschedules used 1.62M gas on testnet. The network charges the contract
// TICK_GAS_PRICE per gas used; the contract reserves at twice that, as the deploy script sets it up.
// Hardhat counts in wei where Hedera counts in tinybar, which changes nothing here.
const TICK_GAS_LIMIT = 1_900_000n;
const TICK_GAS_PRICE = 100n;
const RESERVE_GAS_PRICE = 2n * TICK_GAS_PRICE;
const RESERVE = TICK_GAS_LIMIT * RESERVE_GAS_PRICE;

enum StopReason {
  Completed,
  StoppedByOwner,
  PullFailed,
  GasDepositExhausted,
  ScheduleFailed,
}

const tooLittleReceived = new ethers.Interface(["function Error(string)"]).encodeFunctionData("Error", [
  "Too little received",
]);

type StructLog = { depth: number; op: string; stack: string[] };

/** The contracts a transaction's top-level frame calls, in order, read from Hardhat's opcode trace. */
async function topLevelCalls(txHash: string): Promise<{ op: string; to: string }[]> {
  const { structLogs } = (await network.provider.send("debug_traceTransaction", [
    txHash,
    { disableMemory: true, disableStorage: true },
  ])) as { structLogs: StructLog[] };
  const depth = structLogs[0].depth;
  return structLogs
    .filter(log => log.depth === depth && (log.op === "CALL" || log.op === "STATICCALL"))
    .map(log => {
      // CALL and STATICCALL both take the target address as their second stack argument.
      const word = BigInt(`0x${log.stack[log.stack.length - 2].replace(/^0x/, "")}`);
      return { op: log.op, to: ethers.getAddress(ethers.toBeHex(word & ((1n << 160n) - 1n), 20)) };
    });
}

describe("RecurringBuy", function () {
  async function deployFixture() {
    const [deployer, alice, bob, stranger] = await ethers.getSigners();

    // HSS is a system contract at a fixed address on Hedera; put the mock's runtime code there.
    const hssFactory = await ethers.getContractFactory("MockScheduleService");
    const hssTemplate = await hssFactory.deploy();
    await network.provider.send("hardhat_setCode", [HSS, await ethers.provider.getCode(hssTemplate)]);
    const hss = hssFactory.attach(HSS) as MockScheduleService;
    await hss.setResponseCodes(SUCCESS, SUCCESS);

    const whbar = await ethers.deployContract("MockHtsToken", ["Wrapped HBAR", "WHBAR", 8]);
    const sauce = await ethers.deployContract("MockHtsToken", ["SAUCE", "SAUCE", 6]);
    const router = await ethers.deployContract("MockSaucerSwapRouter");
    await router.associate(whbar);
    await router.setRate(SAUCE_PER_TICK, AMOUNT_PER_TICK);

    const recurringBuy = await ethers.deployContract("RecurringBuy", [router, RESERVE_GAS_PRICE]);
    const recurringBuyAddress = await recurringBuy.getAddress();

    // Alice and Bob hold WHBAR, can receive SAUCE, and allow the contract three slices each.
    for (const user of [alice, bob]) {
      await whbar.connect(user).associate();
      await sauce.connect(user).associate();
      await whbar.mint(user, 10n * AMOUNT_PER_TICK);
      await whbar.connect(user).approve(recurringBuy, 3n * AMOUNT_PER_TICK);
    }

    const planParams = async (overrides: Record<string, unknown> = {}) => ({
      tokenIn: await whbar.getAddress(),
      fee: FEE,
      tokenOut: await sauce.getAddress(),
      amountPerTick: AMOUNT_PER_TICK,
      minAmountOut: MIN_AMOUNT_OUT,
      period: PERIOD,
      maxTicks: 0n,
      tickGasLimit: TICK_GAS_LIMIT,
      ...overrides,
    });

    type StartOptions = { deposit?: bigint } & Record<string, unknown>;
    const start = async (user = alice, { deposit = 3n * RESERVE, ...overrides }: StartOptions = {}) =>
      recurringBuy.connect(user).start(await planParams(overrides), { value: deposit });

    /** Starts a plan for `user` and returns its id. */
    const startPlan = async (user = alice, options: StartOptions = {}) => {
      await start(user, options);
      return recurringBuy.planCount();
    };

    /**
     * Does what Hedera does at a schedule's expiry second: sends the latest call scheduled for `planId`
     * from the contract that scheduled it, which pays the gas used at TICK_GAS_PRICE. `early` runs it
     * `early` seconds before that second (on testnet block.timestamp in a tick was 1-2 s before it).
     */
    const runTick = async (planId: bigint, { early = 0n } = {}) => {
      const tickData = recurringBuy.interface.encodeFunctionData("tick", [planId]);
      for (let index = (await hss.callCount()) - 1n; index >= 0n; index--) {
        const call = await hss.callAt(index);
        if (call.callData !== tickData || call.responseCode !== SUCCESS) continue;
        const runAt = call.expirySecond - early;
        if (runAt > BigInt(await time.latest())) await time.setNextBlockTimestamp(runAt);
        const payer = await ethers.getImpersonatedSigner(call.to);
        await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
        return payer.sendTransaction({
          to: call.to,
          data: call.callData,
          gasLimit: call.gasLimit,
          gasPrice: TICK_GAS_PRICE,
        });
      }
      throw new Error(`no tick scheduled for plan ${planId}`);
    };

    return {
      recurringBuy,
      recurringBuyAddress,
      hss,
      whbar,
      sauce,
      router,
      deployer,
      alice,
      bob,
      stranger,
      planParams,
      start,
      startPlan,
      runTick,
    };
  }

  describe("deployment", function () {
    it("stores the router and the reservation gas price", async function () {
      const { recurringBuy, router } = await loadFixture(deployFixture);
      expect(await recurringBuy.router()).to.equal(await router.getAddress());
      expect(await recurringBuy.reserveGasPrice()).to.equal(RESERVE_GAS_PRICE);
    });

    it("rejects a zero router or a zero reservation gas price", async function () {
      const { recurringBuy, router } = await loadFixture(deployFixture);
      await expect(
        ethers.deployContract("RecurringBuy", [ethers.ZeroAddress, RESERVE_GAS_PRICE]),
      ).to.be.revertedWithCustomError(recurringBuy, "InvalidConfig");
      await expect(ethers.deployContract("RecurringBuy", [router, 0n])).to.be.revertedWithCustomError(
        recurringBuy,
        "InvalidConfig",
      );
    });
  });

  describe("start", function () {
    it("stores the plan and keeps the deposit minus the first tick's reservation", async function () {
      const { recurringBuy, whbar, sauce, alice, planParams } = await loadFixture(deployFixture);

      const start = recurringBuy.connect(alice).start(await planParams({ maxTicks: 3n }), { value: 3n * RESERVE });
      await expect(start)
        .to.emit(recurringBuy, "PlanCreated")
        .withArgs(1n, alice.address, anyValue, 3n * RESERVE);
      await expect(start).to.changeEtherBalances([alice, recurringBuy], [-3n * RESERVE, 3n * RESERVE]);

      const plan = await recurringBuy.plans(1n);
      expect(plan.owner).to.equal(alice.address);
      expect(plan.active).to.equal(true);
      expect(plan.ticksDone).to.equal(0n);
      expect(plan.tokenIn).to.equal(await whbar.getAddress());
      expect(plan.fee).to.equal(FEE);
      expect(plan.tokenOut).to.equal(await sauce.getAddress());
      expect(plan.amountPerTick).to.equal(AMOUNT_PER_TICK);
      expect(plan.minAmountOut).to.equal(MIN_AMOUNT_OUT);
      expect(plan.period).to.equal(PERIOD);
      expect(plan.maxTicks).to.equal(3n);
      expect(plan.tickGasLimit).to.equal(TICK_GAS_LIMIT);
      expect(plan.gasDeposit).to.equal(2n * RESERVE);
      expect(await recurringBuy.planCount()).to.equal(1n);
    });

    it("associates the contract with the input token and approves the router, once per token", async function () {
      const { recurringBuy, recurringBuyAddress, whbar, router, bob, start } = await loadFixture(deployFixture);

      await expect(start()).to.emit(whbar, "Associated").withArgs(recurringBuyAddress);
      expect(await whbar.allowance(recurringBuy, router)).to.equal(INT64_MAX);
      expect(await recurringBuy.tokenReady(whbar)).to.equal(true);

      await expect(start(bob)).not.to.emit(whbar, "Associated");
    });

    it("accepts a token the contract is already associated with (response code 194)", async function () {
      const { recurringBuy, recurringBuyAddress, whbar, router, startPlan } = await loadFixture(deployFixture);
      const self = await ethers.getImpersonatedSigner(recurringBuyAddress);
      await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
      await whbar.connect(self).associate({ gasPrice: 0 });

      await startPlan();
      expect(await whbar.allowance(recurringBuy, router)).to.equal(INT64_MAX);
    });

    it("rejects an incomplete plan", async function () {
      const { recurringBuy, whbar, alice, planParams } = await loadFixture(deployFixture);
      const rescheduleGas = await recurringBuy.RESCHEDULE_GAS();
      const invalid = [
        { tokenIn: ethers.ZeroAddress },
        { tokenOut: ethers.ZeroAddress },
        { tokenOut: await whbar.getAddress() },
        { amountPerTick: 0n },
        { minAmountOut: 0n },
        { period: 0n },
        { tickGasLimit: 0n },
        { tickGasLimit: rescheduleGas },
      ];
      for (const overrides of invalid) {
        await expect(
          recurringBuy.connect(alice).start(await planParams(overrides), { value: RESERVE }),
        ).to.be.revertedWithCustomError(recurringBuy, "InvalidPlan");
      }
    });

    it("rejects a deposit that cannot pay for the first tick", async function () {
      const { recurringBuy, alice, planParams } = await loadFixture(deployFixture);
      await expect(recurringBuy.connect(alice).start(await planParams(), { value: RESERVE - 1n }))
        .to.be.revertedWithCustomError(recurringBuy, "InsufficientGasDeposit")
        .withArgs(RESERVE);
    });

    it("reverts when Hedera refuses to schedule the first tick", async function () {
      const { recurringBuy, hss, start } = await loadFixture(deployFixture);
      await hss.setResponseCodes(INSUFFICIENT_PAYER_BALANCE, SUCCESS);
      await expect(start())
        .to.be.revertedWithCustomError(recurringBuy, "ScheduleCallFailed")
        .withArgs(INSUFFICIENT_PAYER_BALANCE);
      expect(await recurringBuy.planCount()).to.equal(0n);
    });
  });

  describe("scheduling", function () {
    it("schedules the first tick: this contract, one period ahead, the plan's gas limit, no value", async function () {
      const { recurringBuy, recurringBuyAddress, hss, start } = await loadFixture(deployFixture);
      const startedAt = (await time.latest()) + 100;
      await time.setNextBlockTimestamp(startedAt);

      await expect(start())
        .to.emit(recurringBuy, "TickScheduled")
        .withArgs(1n, 1n, anyValue, BigInt(startedAt) + PERIOD);

      expect(await hss.callCount()).to.equal(1n);
      const call = await hss.callAt(0n);
      expect(call.to).to.equal(recurringBuyAddress);
      expect(call.expirySecond).to.equal(BigInt(startedAt) + PERIOD);
      expect(call.gasLimit).to.equal(TICK_GAS_LIMIT);
      expect(call.value).to.equal(0n);
      expect(call.callData).to.equal(recurringBuy.interface.encodeFunctionData("tick", [1n]));

      const plan = await recurringBuy.plans(1n);
      expect(plan.nextSchedule).to.equal(call.schedule);
      expect(plan.nextExpiry).to.equal(call.expirySecond);
    });

    it("moves to a later second when the ideal one has no capacity", async function () {
      const { hss, startPlan } = await loadFixture(deployFixture);
      const startedAt = (await time.latest()) + 100;
      const ideal = BigInt(startedAt) + PERIOD;
      await hss.setBusy(ideal, true);
      await hss.setBusy(ideal + 1n, true);
      await time.setNextBlockTimestamp(startedAt);

      await startPlan();
      expect((await hss.callAt(0n)).expirySecond).to.equal(ideal + 2n);
    });

    it("gives up when the ideal second and the ones 1, 2, 4, 8 and 16 s later are all full", async function () {
      const { recurringBuy, hss, start } = await loadFixture(deployFixture);
      const startedAt = (await time.latest()) + 100;
      const ideal = BigInt(startedAt) + PERIOD;
      for (const delay of [0n, 1n, 2n, 4n, 8n, 16n]) await hss.setBusy(ideal + delay, true);
      await time.setNextBlockTimestamp(startedAt);

      await expect(start())
        .to.be.revertedWithCustomError(recurringBuy, "ScheduleCallFailed")
        .withArgs(SCHEDULE_EXPIRY_IS_BUSY);
    });
  });

  describe("tick", function () {
    it("runs only when called by the contract itself, as Hedera does", async function () {
      const { recurringBuy, alice, stranger, startPlan } = await loadFixture(deployFixture);
      await startPlan();

      await expect(recurringBuy.connect(stranger).tick(1n)).to.be.revertedWithCustomError(recurringBuy, "OnlySelf");
      await expect(recurringBuy.connect(alice).tick(1n)).to.be.revertedWithCustomError(recurringBuy, "OnlySelf");
      await expect(recurringBuy.connect(stranger).buy(1n)).to.be.revertedWithCustomError(recurringBuy, "OnlySelf");
    });

    it("does not wait for the expiry second (Hedera runs the tick a second or two before it)", async function () {
      const { recurringBuy, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();
      await expect(runTick(1n, { early: 2n })).to.emit(recurringBuy, "TickExecuted");
    });

    it("pulls one slice from the owner and swaps it on SaucerSwap to the owner", async function () {
      const { recurringBuy, whbar, sauce, router, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();

      const tick = runTick(1n);
      await expect(tick).to.emit(recurringBuy, "TickExecuted").withArgs(1n, 1n, AMOUNT_PER_TICK, SAUCE_PER_TICK);
      await expect(tick).to.changeTokenBalances(whbar, [alice, recurringBuy], [-AMOUNT_PER_TICK, 0n]);
      expect(await sauce.balanceOf(alice)).to.equal(SAUCE_PER_TICK);
      expect(await router.lastPath()).to.equal(
        ethers.solidityPacked(
          ["address", "uint24", "address"],
          [await whbar.getAddress(), FEE, await sauce.getAddress()],
        ),
      );
      expect((await recurringBuy.plans(1n)).ticksDone).to.equal(1n);
    });

    it("schedules the next tick exactly once, as its last external call", async function () {
      const { recurringBuy, recurringBuyAddress, hss, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();

      const tick = await runTick(1n);
      await expect(tick).to.emit(recurringBuy, "TickScheduled").withArgs(1n, 2n, anyValue, anyValue);
      expect(await hss.callCount()).to.equal(2n);

      // buy() through a self-call, then hasScheduleCapacity, then scheduleCall - nothing after it.
      expect(await topLevelCalls(tick.hash)).to.deep.equal([
        { op: "CALL", to: recurringBuyAddress },
        { op: "STATICCALL", to: HSS },
        { op: "CALL", to: HSS },
      ]);
    });

    it("skips a tick below the price floor, takes nothing and keeps the plan going", async function () {
      const { recurringBuy, whbar, sauce, router, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();
      await router.setRate(SAUCE_PER_TICK / 2n, AMOUNT_PER_TICK);

      const skipped = runTick(1n);
      await expect(skipped).to.emit(recurringBuy, "TickSkipped").withArgs(1n, 1n, tooLittleReceived);
      await expect(skipped).to.emit(recurringBuy, "TickScheduled").withArgs(1n, 2n, anyValue, anyValue);
      await expect(skipped).to.changeTokenBalance(whbar, alice, 0n);
      expect(await sauce.balanceOf(alice)).to.equal(0n);
      const plan = await recurringBuy.plans(1n);
      expect(plan.active).to.equal(true);
      expect(plan.gasDeposit).to.equal(RESERVE);

      await router.setRate(SAUCE_PER_TICK, AMOUNT_PER_TICK);
      await expect(runTick(1n)).to.emit(recurringBuy, "TickExecuted").withArgs(1n, 2n, AMOUNT_PER_TICK, SAUCE_PER_TICK);
    });

    it("counts skipped ticks toward maxTicks", async function () {
      const { recurringBuy, sauce, router, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan(alice, { maxTicks: 2n, deposit: 2n * RESERVE });
      await router.setRate(SAUCE_PER_TICK / 2n, AMOUNT_PER_TICK);

      await expect(runTick(1n)).to.emit(recurringBuy, "TickSkipped");
      const last = runTick(1n);
      await expect(last).to.emit(recurringBuy, "TickSkipped").withArgs(1n, 2n, tooLittleReceived);
      await expect(last).to.emit(recurringBuy, "PlanStopped").withArgs(1n, 2n, StopReason.Completed, 0n);
      expect(await sauce.balanceOf(alice)).to.equal(0n);
    });

    it("skips a swap that runs out of gas and still schedules the next tick", async function () {
      const { recurringBuy, whbar, router, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();
      await router.setBurnGas(true);

      const tick = runTick(1n);
      await expect(tick).to.emit(recurringBuy, "TickSkipped").withArgs(1n, 1n, "0x");
      await expect(tick).to.emit(recurringBuy, "TickScheduled").withArgs(1n, 2n, anyValue, anyValue);
      await expect(tick).to.changeTokenBalance(whbar, alice, 0n);
    });

    it("skips the tick when a token or pool calls back into the contract", async function () {
      const { recurringBuy, whbar, sauce, router, stranger, planParams, runTick } = await loadFixture(deployFixture);
      // The router (standing in for a hostile pool) owns a plan and, mid-swap, tries to stop it: that would
      // refund the reservation of the tick that is running, which the network then bills to everyone else.
      await router.associate(sauce);
      await whbar.mint(router, 3n * AMOUNT_PER_TICK);
      await router.execute(
        whbar,
        whbar.interface.encodeFunctionData("approve", [await recurringBuy.getAddress(), AMOUNT_PER_TICK]),
      );
      const startData = recurringBuy.interface.encodeFunctionData("start", [await planParams()]);
      await router.execute(recurringBuy, startData, { value: 3n * RESERVE });
      expect((await recurringBuy.plans(1n)).owner).to.equal(await router.getAddress());
      await router.setCallback(recurringBuy, recurringBuy.interface.encodeFunctionData("stop", [1n, stranger.address]));

      const reentrantCall = recurringBuy.interface.getError("ReentrancyGuardReentrantCall")!.selector;
      const tick = runTick(1n);
      await expect(tick).to.emit(recurringBuy, "TickSkipped").withArgs(1n, 1n, reentrantCall);
      await expect(tick).to.emit(recurringBuy, "TickScheduled").withArgs(1n, 2n, anyValue, anyValue);
      const plan = await recurringBuy.plans(1n);
      expect(plan.active).to.equal(true);
      expect(plan.gasDeposit).to.equal(RESERVE);
    });

    it("stops the plan when the owner revokes the allowance", async function () {
      const { recurringBuy, hss, whbar, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();
      await whbar.connect(alice).approve(recurringBuy, 0n);

      const tick = runTick(1n);
      await expect(tick).to.emit(recurringBuy, "PlanStopped").withArgs(1n, 1n, StopReason.PullFailed, 0n);
      await expect(tick).to.changeTokenBalance(whbar, alice, 0n);
      expect(await hss.callCount()).to.equal(1n);
      expect((await recurringBuy.plans(1n)).active).to.equal(false);
    });

    it("stops the plan when the owner's balance is below one slice", async function () {
      const { recurringBuy, hss, whbar, alice, bob, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();
      await whbar.connect(alice).transfer(bob, (await whbar.balanceOf(alice)) - AMOUNT_PER_TICK + 1n);

      await expect(runTick(1n)).to.emit(recurringBuy, "PlanStopped").withArgs(1n, 1n, StopReason.PullFailed, 0n);
      expect(await hss.callCount()).to.equal(1n);
    });

    it("stops the plan when the token returns false instead of reverting", async function () {
      const { recurringBuy, whbar, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();
      await whbar.setQuietFailure(true);
      await whbar.connect(alice).approve(recurringBuy, 0n);

      await expect(runTick(1n)).to.emit(recurringBuy, "PlanStopped").withArgs(1n, 1n, StopReason.PullFailed, 0n);
    });

    it("stops after maxTicks without scheduling another tick", async function () {
      const { recurringBuy, hss, sauce, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan(alice, { maxTicks: 2n, deposit: 2n * RESERVE });

      await expect(runTick(1n)).to.emit(recurringBuy, "TickScheduled").withArgs(1n, 2n, anyValue, anyValue);
      const last = runTick(1n);
      await expect(last).to.emit(recurringBuy, "TickExecuted").withArgs(1n, 2n, AMOUNT_PER_TICK, SAUCE_PER_TICK);
      await expect(last).to.emit(recurringBuy, "PlanStopped").withArgs(1n, 2n, StopReason.Completed, 0n);
      await expect(last).not.to.emit(recurringBuy, "TickScheduled");

      expect(await hss.callCount()).to.equal(2n);
      expect(await sauce.balanceOf(alice)).to.equal(2n * SAUCE_PER_TICK);
      const plan = await recurringBuy.plans(1n);
      expect(plan.active).to.equal(false);
      expect(plan.nextSchedule).to.equal(ethers.ZeroAddress);
      expect(plan.nextExpiry).to.equal(0n);
    });

    it("stops the plan when Hedera refuses to schedule the next tick", async function () {
      const { recurringBuy, hss, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan();
      await hss.setResponseCodes(INSUFFICIENT_PAYER_BALANCE, SUCCESS);

      const tick = runTick(1n);
      await expect(tick).to.emit(recurringBuy, "TickExecuted");
      await expect(tick)
        .to.emit(recurringBuy, "PlanStopped")
        .withArgs(1n, 1n, StopReason.ScheduleFailed, INSUFFICIENT_PAYER_BALANCE);
      const plan = await recurringBuy.plans(1n);
      expect(plan.active).to.equal(false);
      expect(plan.gasDeposit).to.equal(2n * RESERVE);
    });
  });

  describe("gas deposit", function () {
    it("never spends one plan's deposit on another plan's ticks", async function () {
      const { recurringBuy, hss, alice, bob, startPlan, runTick } = await loadFixture(deployFixture);
      const planA = await startPlan(alice, { deposit: 2n * RESERVE });
      const planB = await startPlan(bob, { deposit: 5n * RESERVE });
      const balanceBefore = await ethers.provider.getBalance(recurringBuy);

      const first = await runTick(planA);
      await expect(first).to.emit(recurringBuy, "TickScheduled");
      expect((await recurringBuy.plans(planA)).gasDeposit).to.equal(0n);

      const callsBefore = await hss.callCount();
      const exhausted = await runTick(planA);
      await expect(exhausted).to.emit(recurringBuy, "TickExecuted");
      await expect(exhausted)
        .to.emit(recurringBuy, "PlanStopped")
        .withArgs(planA, 2n, StopReason.GasDepositExhausted, 0n);
      expect(await hss.callCount()).to.equal(callsBefore);

      // The network billed plan A's two ticks to the contract, and they cost less than A reserved for them,
      // so the contract still holds all of plan B's deposit and B's pending reservation.
      let billed = 0n;
      for (const tx of [first, exhausted]) billed += (await tx.wait())!.fee;
      expect(billed).to.be.greaterThan(0n);
      expect(await ethers.provider.getBalance(recurringBuy)).to.equal(balanceBefore - billed);
      expect(billed).to.be.lessThanOrEqual(2n * RESERVE);
      const planBState = await recurringBuy.plans(planB);
      expect(planBState.gasDeposit).to.equal(4n * RESERVE);
      expect(await ethers.provider.getBalance(recurringBuy)).to.be.greaterThanOrEqual(planBState.gasDeposit + RESERVE);

      await expect(runTick(planB)).to.emit(recurringBuy, "TickScheduled").withArgs(planB, 2n, anyValue, anyValue);
      expect((await recurringBuy.plans(planB)).gasDeposit).to.equal(3n * RESERVE);
    });

    it("lets anyone top up a running plan, and only a running one", async function () {
      const { recurringBuy, alice, stranger, startPlan, runTick } = await loadFixture(deployFixture);
      const planId = await startPlan(alice, { deposit: RESERVE });
      expect((await recurringBuy.plans(planId)).gasDeposit).to.equal(0n);

      await expect(recurringBuy.connect(stranger).topUp(planId, { value: RESERVE }))
        .to.emit(recurringBuy, "GasDepositAdded")
        .withArgs(planId, RESERVE);
      await expect(runTick(planId)).to.emit(recurringBuy, "TickScheduled").withArgs(planId, 2n, anyValue, anyValue);

      await recurringBuy.connect(alice).stop(planId, alice.address);
      await expect(recurringBuy.connect(stranger).topUp(planId, { value: RESERVE }))
        .to.be.revertedWithCustomError(recurringBuy, "PlanNotActive")
        .withArgs(planId);
    });
  });

  describe("stop", function () {
    it("refunds the whole deposit when Hedera deletes the pending tick's schedule", async function () {
      const { recurringBuy, hss, alice, startPlan } = await loadFixture(deployFixture);
      await startPlan(alice, { deposit: 3n * RESERVE });
      const pending = (await recurringBuy.plans(1n)).nextSchedule;

      const stop = recurringBuy.connect(alice).stop(1n, alice.address);
      await expect(stop).to.emit(recurringBuy, "PlanStopped").withArgs(1n, 0n, StopReason.StoppedByOwner, SUCCESS);
      await expect(stop)
        .to.emit(recurringBuy, "GasRefunded")
        .withArgs(1n, alice.address, 3n * RESERVE);
      await expect(stop).to.changeEtherBalances([alice, recurringBuy], [3n * RESERVE, -3n * RESERVE]);
      expect(await hss.lastDeleted()).to.equal(pending);
      const plan = await recurringBuy.plans(1n);
      expect(plan.active).to.equal(false);
      expect(plan.nextSchedule).to.equal(ethers.ZeroAddress);
    });

    it("keeps the pending tick's reservation when its schedule cannot be deleted; that tick then reverts", async function () {
      const { recurringBuy, hss, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan(alice, { deposit: 3n * RESERVE });
      await hss.setResponseCodes(SUCCESS, INVALID_SCHEDULE_ID);

      const stop = recurringBuy.connect(alice).stop(1n, alice.address);
      await expect(stop)
        .to.emit(recurringBuy, "PlanStopped")
        .withArgs(1n, 0n, StopReason.StoppedByOwner, INVALID_SCHEDULE_ID);
      await expect(stop).to.changeEtherBalance(alice, 2n * RESERVE);

      await expect(runTick(1n)).to.be.revertedWithCustomError(recurringBuy, "PlanNotActive").withArgs(1n);
    });

    it("returns what is left of the deposit of a plan that ended by itself", async function () {
      const { recurringBuy, whbar, alice, startPlan, runTick } = await loadFixture(deployFixture);
      await startPlan(alice, { deposit: 3n * RESERVE });
      await whbar.connect(alice).approve(recurringBuy, 0n);
      await runTick(1n);

      const stop = recurringBuy.connect(alice).stop(1n, alice.address);
      await expect(stop).not.to.emit(recurringBuy, "PlanStopped");
      await expect(stop)
        .to.emit(recurringBuy, "GasRefunded")
        .withArgs(1n, alice.address, 2n * RESERVE);
      await expect(recurringBuy.connect(alice).stop(1n, alice.address))
        .to.be.revertedWithCustomError(recurringBuy, "NothingToRefund")
        .withArgs(1n);
    });

    it("lets only the owner stop a plan and take its deposit", async function () {
      const { recurringBuy, alice, stranger, startPlan } = await loadFixture(deployFixture);
      await startPlan(alice, { deposit: 3n * RESERVE });

      await expect(recurringBuy.connect(stranger).stop(1n, stranger.address))
        .to.be.revertedWithCustomError(recurringBuy, "NotPlanOwner")
        .withArgs(1n);
      const plan = await recurringBuy.plans(1n);
      expect(plan.active).to.equal(true);
      expect(plan.gasDeposit).to.equal(2n * RESERVE);
    });

    it("sends the refund where the owner asks, and stops nothing if that address refuses HBAR", async function () {
      const { recurringBuy, whbar, alice, bob, startPlan } = await loadFixture(deployFixture);
      await startPlan(alice, { deposit: 3n * RESERVE });

      // A contract with no receive function (here the token) cannot take the refund.
      await expect(recurringBuy.connect(alice).stop(1n, await whbar.getAddress()))
        .to.be.revertedWithCustomError(recurringBuy, "RefundFailed")
        .withArgs(1n);
      expect((await recurringBuy.plans(1n)).active).to.equal(true);

      const stop = recurringBuy.connect(alice).stop(1n, bob.address);
      await expect(stop)
        .to.emit(recurringBuy, "GasRefunded")
        .withArgs(1n, bob.address, 3n * RESERVE);
      await expect(stop).to.changeEtherBalance(bob, 3n * RESERVE);
    });
  });
});
