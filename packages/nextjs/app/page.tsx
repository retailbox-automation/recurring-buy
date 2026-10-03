import Link from "next/link";
import type { NextPage } from "next";
import { ReferenceOverview } from "~~/components/recurring-buy/ReferencePlan";

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
    <ReferenceOverview />
  </div>
);

export default Home;
