// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService } from "../interfaces/IHederaTokenService.sol";

/// @notice Test stand-in for the Hedera Token Service. Tests put its runtime code at 0x167 (`hardhat_setCode`,
/// `vm.etch`), so storage starts empty: they set the response code before anything else. A token has an
/// infinite supply until a test gives it a maximum supply.
contract MockTokenService is IHederaTokenService {
    int64 public responseCode;
    mapping(address token => int64) public maxSupplyOf;

    function setResponseCode(int64 responseCode_) external {
        responseCode = responseCode_;
    }

    /// @param maxSupply 0 for an infinite supply, else the token's maximum supply.
    function setMaxSupply(address token, int64 maxSupply) external {
        maxSupplyOf[token] = maxSupply;
    }

    function getTokenInfo(address token) external view returns (int64, TokenInfo memory info) {
        info.token.tokenSupplyType = maxSupplyOf[token] != 0;
        info.token.maxSupply = maxSupplyOf[token];
        return (responseCode, info);
    }
}
