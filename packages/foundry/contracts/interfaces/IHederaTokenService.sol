// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Hedera Token Service system contract at 0x167: the one function RecurringBuy calls, with the
/// structs of its result. The field layout is Hedera's own IHederaTokenService (hedera-smart-contracts);
/// it has to match exactly for the result to decode.
interface IHederaTokenService {
    struct KeyValue {
        bool inheritAccountKey;
        address contractId;
        bytes ed25519;
        bytes ECDSA_secp256k1;
        address delegatableContractId;
    }

    struct TokenKey {
        uint256 keyType;
        KeyValue key;
    }

    struct Expiry {
        int64 second;
        address autoRenewAccount;
        int64 autoRenewPeriod;
    }

    struct HederaToken {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool tokenSupplyType; // true = FINITE, false = INFINITE
        int64 maxSupply; // for a FINITE token, the most that can ever exist, in its smallest unit
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    struct FixedFee {
        int64 amount;
        address tokenId;
        bool useHbarsForPayment;
        bool useCurrentTokenForPayment;
        address feeCollector;
    }

    struct FractionalFee {
        int64 numerator;
        int64 denominator;
        int64 minimumAmount;
        int64 maximumAmount;
        bool netOfTransfers;
        address feeCollector;
    }

    struct RoyaltyFee {
        int64 numerator;
        int64 denominator;
        int64 amount;
        address tokenId;
        bool useHbarsForPayment;
        address feeCollector;
    }

    struct TokenInfo {
        HederaToken token;
        int64 totalSupply;
        bool deleted;
        bool defaultKycStatus;
        bool pauseStatus;
        FixedFee[] fixedFees;
        FractionalFee[] fractionalFees;
        RoyaltyFee[] royaltyFees;
        string ledgerId;
    }

    /// @notice The token's properties. Returns a HAPI response code: 22 SUCCESS, anything else is a failure.
    function getTokenInfo(address token) external returns (int64 responseCode, TokenInfo memory tokenInfo);
}
