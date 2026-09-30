// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice HIP-719 token facade: every HTS token address lets the caller associate itself with the token.
interface IHRC719 {
    /// @notice Associates the caller with this token. Returns a HAPI response code: 22 SUCCESS,
    /// 194 TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, anything else is a failure.
    function associate() external returns (int64 responseCode);
}
