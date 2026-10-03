import { MyPlans } from "~~/components/recurring-buy/MyPlans";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "My plans",
  description: "Your recurring buys on SaucerSwap, their ticks, and how to stop them.",
});

const MyPlansPage = () => (
  <div className="w-full max-w-[1680px] mx-auto px-4 sm:px-6 xl:px-10 py-6">
    <MyPlans />
  </div>
);

export default MyPlansPage;
