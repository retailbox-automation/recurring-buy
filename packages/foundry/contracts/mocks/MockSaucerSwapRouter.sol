// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";

import { IHRC719 } from "../interfaces/IHRC719.sol";
import { ISaucerSwapV2Router } from "../interfaces/ISaucerSwapV2Router.sol";
import { MockHtsToken } from "./MockHtsToken.sol";

/// @notice Test stand-in for SaucerSwapV2SwapRouter on a single-hop path at a fixed rate: it pulls
/// `amountIn` from the caller, mints `amountIn * numerator / denominator` of the output token to the
/// recipient, and reverts with SaucerSwap's own "Too little received" below `amountOutMinimum`.
/// Tests can also make a swap burn all its gas, or call back into another contract mid-swap the way a
/// hostile token or pool could; `execute` lets the router act as an ordinary account in a test.
contract MockSaucerSwapRouter is ISaucerSwapV2Router {
    uint256 public rateNumerator;
    uint256 public rateDenominator;
    bytes public lastPath;
    bool public burnGas;
    address public callbackTarget;
    bytes public callbackData;

    function setRate(uint256 numerator, uint256 denominator) external {
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function setBurnGas(bool burn) external {
        burnGas = burn;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function execute(address target, bytes calldata data) external payable returns (bytes memory) {
        return Address.functionCallWithValue(target, data, msg.value);
    }

    /// @notice The router has to be associated with a token before it can take it in (HTS rule).
    function associate(address token) external {
        IHRC719(token).associate();
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        require(block.timestamp <= params.deadline, "Transaction too old");
        if (burnGas) while (gasleft() > 0) {}
        if (callbackTarget != address(0)) Address.functionCall(callbackTarget, callbackData);
        require(params.path.length == 43, "single hop only");
        lastPath = params.path;
        MockHtsToken(address(bytes20(params.path[:20]))).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = (params.amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= params.amountOutMinimum, "Too little received");
        MockHtsToken(address(bytes20(params.path[23:]))).mint(params.recipient, amountOut);
    }
}
