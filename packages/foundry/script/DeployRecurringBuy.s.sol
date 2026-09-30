// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console } from "forge-std/Script.sol";

import { RecurringBuy } from "../contracts/RecurringBuy.sol";
import { ISaucerSwapV2Router } from "../contracts/interfaces/ISaucerSwapV2Router.sol";

/// @notice Deploys RecurringBuy with SaucerSwap's V2 router for the network and a reserve gas price of twice the
/// gas price the relay reports.
contract DeployRecurringBuy is Script {
    // SaucerSwapV2SwapRouter, the same addresses as packages/saucerswap/src/addresses.ts. The testnet router has
    // carried live swaps; the mainnet one is taken from SaucerSwap's docs.
    address private constant TESTNET_ROUTER = 0x0000000000000000000000000000000000159398; // 0.0.1414040
    address private constant MAINNET_ROUTER = 0x00000000000000000000000000000000003c437A; // 0.0.3949434

    // JSON-RPC reports gas prices in weibar (18 decimals); inside the EVM Hedera counts HBAR in tinybar (8).
    uint256 private constant WEIBAR_PER_TINYBAR = 10 ** 10;
    // The margin keeps a reservation large enough if HBAR loses up to half its value against the
    // dollar-denominated gas price.
    uint256 private constant RESERVE_MARGIN = 2;

    function run() external returns (RecurringBuy recurringBuy) {
        address router;
        if (block.chainid == 296) router = TESTNET_ROUTER;
        else if (block.chainid == 295) router = MAINNET_ROUTER;
        // Ticks run through the Hedera Schedule Service at 0x16b, which a local chain does not have.
        else revert("RecurringBuy needs Hedera testnet (296) or mainnet (295)");

        uint256 reserveGasPrice = _relayGasPrice() * RESERVE_MARGIN / WEIBAR_PER_TINYBAR;
        vm.startBroadcast();
        recurringBuy = new RecurringBuy(ISaucerSwapV2Router(router), reserveGasPrice);
        vm.stopBroadcast();
        console.log("RecurringBuy deployed at", address(recurringBuy));
        console.log("reserve gas price (tinybar per gas):", reserveGasPrice);
    }

    /// eth_gasPrice of the relay, in weibar. vm.rpc returns the quantity as big-endian bytes.
    function _relayGasPrice() private returns (uint256) {
        bytes memory quantity = vm.rpc("eth_gasPrice", "[]");
        require(quantity.length > 0 && quantity.length <= 32, "eth_gasPrice returned no quantity");
        return uint256(bytes32(quantity)) >> (8 * (32 - quantity.length));
    }
}
