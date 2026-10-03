import Link from "next/link";
import type { NextPage } from "next";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { CumulativeChart } from "~~/components/recurring-buy/CumulativeChart";
import { FlowDiagram } from "~~/components/recurring-buy/FlowDiagram";
import { ForDevelopers } from "~~/components/recurring-buy/ForDevelopers";
import { ReferencePlan } from "~~/components/recurring-buy/ReferencePlan";

const Home: NextPage = () => (
  <div className="w-full max-w-[1680px] mx-auto px-4 sm:px-6 xl:px-10 py-6 flex flex-col gap-5">
    <section className="flex flex-col items-center text-center gap-3">
      <h1 className="m-0 text-4xl md:text-5xl font-bold tracking-tight leading-tight">
        Recurring buys on SaucerSwap.{" "}
        <span className="block sm:inline bg-linear-to-r from-accent to-primary bg-clip-text text-transparent">
          No bot. No server.
        </span>
      </h1>
      <p className="m-0 text-lg md:text-2xl text-base-content/60">
        Hedera schedules every purchase, and your tokens stay in your wallet until each buy.
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-1">
        <Link href="/plans/new" className="btn btn-primary btn-lg px-10">
          Start a plan
        </Link>
        <Link href="/plans" className="btn btn-lg px-10 bg-base-100 border-base-300">
          My plans
        </Link>
      </div>
    </section>

    <section className="flex flex-col gap-3">
      <FlowDiagram />
      <p className="m-0 text-sm text-base-content/60 text-center">
        <b>Next tick:</b> as its last step the tick schedules the next one, paid from the plan&apos;s gas deposit. Steps
        2 to 4 repeat once per period until the plan has run all its ticks, its owner stops it, or the allowance or the
        gas deposit runs out. A tick whose swap would buy below the floor is skipped, and the next one is still
        scheduled.
      </p>
      <p className="m-0 flex items-center justify-center gap-3 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-primary">
        <CheckCircleIcon className="size-6 shrink-0" aria-hidden />
        <span>
          Every tick is executed by the network and paid by the contract. <b>Nobody presses a button.</b>
        </span>
      </p>
    </section>

    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-4 items-start">
      <div className="md:col-span-2 xl:col-span-1">
        <ReferencePlan />
      </div>
      <CumulativeChart />
      <ForDevelopers />
    </div>
  </div>
);

export default Home;
