import Link from "next/link";
import type { NextPage } from "next";
import { FlowDiagram } from "~~/components/recurring-buy/FlowDiagram";
import { ReferencePlan } from "~~/components/recurring-buy/ReferencePlan";

const Home: NextPage = () => (
  <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8">
    <section className="flex flex-col gap-4">
      <p className="m-0 text-sm font-medium tracking-widest uppercase text-primary">Recurring Buy · Hedera</p>
      <h1 className="text-3xl sm:text-4xl font-bold leading-tight m-0 max-w-3xl">
        Dollar-cost average on SaucerSwap — Hedera wakes the contract, your wallet keeps the funds.
      </h1>
      <p className="m-0 max-w-2xl text-base-content/70">
        A plan buys a fixed amount of a token once per period. The network&apos;s own scheduler runs every buy, an HTS
        allowance caps what the contract can take, and each purchase lands in your wallet.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/plans/new" className="btn btn-primary">
          Start a plan
        </Link>
        <Link href="/plans" className="btn btn-outline">
          My plans
        </Link>
      </div>
    </section>

    <section className="flex flex-col gap-3">
      <h2 className="font-bold text-lg m-0">How a plan runs</h2>
      <FlowDiagram />
      <p className="m-0 text-sm text-base-content/60">
        Steps 2 to 4 repeat once per period until the plan has run all its ticks, its owner stops it, or the allowance
        or the gas deposit runs out. A tick whose swap would buy below the floor is skipped, and the next one is still
        scheduled.
      </p>
    </section>

    <ReferencePlan />
  </div>
);

export default Home;
