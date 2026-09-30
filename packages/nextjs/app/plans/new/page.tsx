import { NewPlanForm } from "~~/components/recurring-buy/NewPlanForm";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "New plan",
  description: "Set up a recurring buy on SaucerSwap that Hedera runs on schedule.",
});

const NewPlanPage = () => (
  <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold m-0">Start a plan</h1>
      <p className="m-0 text-base-content/70">
        Up to five transactions, each listed below with its gas: receive the token, get WHBAR if you are short of it,
        cap what the contract may take, then start the plan with its gas deposit.
      </p>
    </div>
    <NewPlanForm />
  </div>
);

export default NewPlanPage;
