import { NewPlanForm } from "~~/components/recurring-buy/NewPlanForm";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "New plan",
  description: "Set up a recurring buy on SaucerSwap that Hedera runs on schedule.",
});

const NewPlanPage = () => (
  <div className="w-full max-w-[1680px] mx-auto px-4 sm:px-6 xl:px-10 py-6 flex flex-col gap-5">
    <div className="flex flex-col gap-2">
      <h1 className="m-0 text-4xl md:text-5xl font-bold tracking-tight">Start a plan</h1>
      <p className="m-0 text-lg text-base-content/60">
        Up to five transactions, each listed with its gas: receive the token, get WHBAR if you are short of it, cap what
        the contract may take, then start the plan with its gas deposit.
      </p>
    </div>
    <NewPlanForm />
  </div>
);

export default NewPlanPage;
