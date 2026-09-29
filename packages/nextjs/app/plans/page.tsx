import { MyPlans } from "~~/components/recurring-buy/MyPlans";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "My plans",
  description: "Your recurring buys on SaucerSwap, their ticks, and how to stop them.",
});

const MyPlansPage = () => (
  <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-10">
    <MyPlans />
  </div>
);

export default MyPlansPage;
