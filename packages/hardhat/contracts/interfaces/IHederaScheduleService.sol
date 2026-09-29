// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Hedera Schedule Service system contract at 0x16b: the HIP-1215 functions RecurringBuy uses.
/// @dev None of these calls revert on a Hedera node. A failure comes back as a response code other than
/// 22 (SUCCESS), an ordinal of HAPI's ResponseCodeEnum, and `scheduleCall` then returns a zero address.
interface IHederaScheduleService {
    /// @notice Schedules `callData` to `to` for `expirySecond`. The calling contract pays for the call
    /// (gas and `value`, in tinybar) when the network executes it.
    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);

    /// @notice Deletes a schedule this contract created. Returns 22 only if the schedule was deleted.
    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode);

    /// @notice True if `expirySecond` still has room for a call with `gasLimit`. Also false for a second
    /// that is not in the future or is too far ahead.
    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool hasCapacity);
}
