// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The one SaucerSwapV2SwapRouter function RecurringBuy calls (the router is Uniswap V3 style).
/// @dev Same signature as `exactInput` in `routerAbi` of packages/saucerswap/src/swap.ts.
interface ISaucerSwapV2Router {
    struct ExactInputParams {
        // tokenIn (20 bytes) | pool fee (3 bytes) | tokenOut (20 bytes), repeated for more hops.
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        // The swap reverts with "Too little received" below this.
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
