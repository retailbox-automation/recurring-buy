import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";

/**
 * SaucerSwapV2SwapRouter per network, the same addresses as packages/saucerswap/src/addresses.ts.
 * The testnet router has carried live swaps; the mainnet one is taken from SaucerSwap's docs.
 * The in-process `hardhat` network forks testnet, so it uses the testnet router.
 */
const SAUCERSWAP_ROUTER: Record<string, string> = {
  hederaTestnet: "0x0000000000000000000000000000000000159398", // 0.0.1414040
  hederaMainnet: "0x00000000000000000000000000000000003c437a", // 0.0.3949434
};

const HEDERA_CHAIN_IDS = [295, 296];
// JSON-RPC reports gas prices in weibar (18 decimals); inside the EVM Hedera counts HBAR in tinybar (8).
const WEIBAR_PER_TINYBAR = 10_000_000_000n;
// RecurringBuy reserves tick gas at twice the gas price seen at deploy time, so a plan's deposit still
// covers its ticks if HBAR loses up to half its value against the dollar-denominated gas price.
const RESERVE_MARGIN = 2n;

const deployRecurringBuy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const gasPrice = await getDeployGasPrice(hre);
  const isHedera = HEDERA_CHAIN_IDS.includes(hre.network.config.chainId ?? 0);
  const nativeGasPrice = isHedera ? BigInt(gasPrice) / WEIBAR_PER_TINYBAR : BigInt(gasPrice);

  await hre.deployments.deploy("RecurringBuy", {
    from: deployer,
    args: [SAUCERSWAP_ROUTER[hre.network.name] ?? SAUCERSWAP_ROUTER.hederaTestnet, nativeGasPrice * RESERVE_MARGIN],
    log: true,
    autoMine: true,
    gasLimit: "1800000", // deploying takes about 1.5M gas
    gasPrice,
  });
};

deployRecurringBuy.tags = ["RecurringBuy"];
export default deployRecurringBuy;
