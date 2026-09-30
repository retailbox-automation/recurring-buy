// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test stand-in for the Hedera Schedule Service. Tests put its runtime code at 0x16b
/// (`hardhat_setCode`, `vm.etch`), so storage starts empty: they set the response codes before anything else.
/// Like the real service it never reverts. A second marked busy has no capacity, and a `scheduleCall`
/// for it returns SCHEDULE_EXPIRY_IS_BUSY. Tests replay a recorded call to play the network's part.
contract MockScheduleService {
    struct ScheduledCall {
        address to;
        uint256 expirySecond;
        uint256 gasLimit;
        uint64 value;
        bytes callData;
        int64 responseCode;
        address schedule;
    }

    int64 private constant SUCCESS = 22;
    int64 private constant SCHEDULE_EXPIRY_IS_BUSY = 370;

    int64 public scheduleResponseCode;
    int64 public deleteResponseCode;
    mapping(uint256 second => bool) public busy;
    address public lastDeleted;
    ScheduledCall[] private _calls;

    function setResponseCodes(int64 scheduleResponseCode_, int64 deleteResponseCode_) external {
        scheduleResponseCode = scheduleResponseCode_;
        deleteResponseCode = deleteResponseCode_;
    }

    function setBusy(uint256 second, bool isBusy) external {
        busy[second] = isBusy;
    }

    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address schedule) {
        responseCode = busy[expirySecond] ? SCHEDULE_EXPIRY_IS_BUSY : scheduleResponseCode;
        // A schedule is a Hedera entity 0.0.N; its address is the long-zero form of N.
        if (responseCode == SUCCESS) schedule = address(uint160(0x5c4ed000 + _calls.length));
        _calls.push(ScheduledCall(to, expirySecond, gasLimit, value, callData, responseCode, schedule));
    }

    function deleteSchedule(address scheduleAddress) external returns (int64) {
        lastDeleted = scheduleAddress;
        return deleteResponseCode;
    }

    function hasScheduleCapacity(uint256 expirySecond, uint256) external view returns (bool) {
        return !busy[expirySecond];
    }

    /// @notice Every `scheduleCall` so far, the refused ones included.
    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function callAt(uint256 index) external view returns (ScheduledCall memory) {
        return _calls[index];
    }
}
