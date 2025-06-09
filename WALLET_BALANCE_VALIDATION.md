# Wallet Balance Validation for Debt Tokens

## Overview

This implementation adds critical wallet balance validation to prevent the liquidation bot from attempting liquidations when it doesn't have sufficient debt tokens to execute them.

## The Problem

Previously, the liquidation bot had a fundamental flaw:
- ✅ It could detect liquidation opportunities 
- ✅ It knew which debt tokens needed to be repaid (USDC, WETH, cbETH, etc.)
- ❌ It never checked if the bot's wallet actually had those tokens
- ❌ This led to failed transactions and wasted gas fees

## The Solution

### 1. Wallet Balance Validation in OpportunityValidator

The `OpportunityValidator` now includes several new methods:

- **`setWalletAddress(walletAddress)`** - Sets the bot's wallet address for balance checks
- **`checkWalletTokenBalance(debtAssetAddress, debtAmount)`** - Checks if wallet has sufficient balance for a specific debt token
- **`checkAllDebtTokenBalances(debtAssets)`** - Checks balances for all debt tokens in a position
- **`logWalletBalances()`** - Logs current balances for debugging and monitoring

### 2. Integration in Validation Flow

The validation now follows this enhanced flow:

```
1. Detect liquidation opportunity
2. Fetch position data (collateral & debt assets)
3. Calculate liquidation parameters
4. 🆕 CHECK WALLET BALANCE FOR DEBT TOKENS
5. Estimate gas costs
6. Calculate expected profit
7. Execute liquidation (if all checks pass)
```

### 3. Special Handling for Different Token Types

- **ETH/WETH**: Checks both native ETH balance and WETH token balance
- **ERC-20 Tokens**: Uses standard `balanceOf()` calls with proper decimal handling
- **Multi-token Positions**: Validates that bot has at least one of the required debt tokens

## Configuration

### Environment Variables

```bash
# Enable/disable wallet balance validation (default: enabled)
ENABLE_WALLET_BALANCE_CHECK=true

# Enable flash loan suggestions when balance is insufficient (default: disabled)
SUGGEST_FLASH_LOANS=true
```

### Integration in LiquidationBot

The main bot automatically:
1. Sets the wallet address in the validator during initialization
2. Logs all major token balances on startup for transparency
3. Validates every liquidation opportunity against wallet balances

## Example Logs

### Startup Balance Logging
```
💰 ETH: 0.1234
💰 USDC: 1000.0
💰 WETH: 0.0 (⚠️  No balance - liquidations requiring WETH will fail)
💰 cbETH: 0.0 (⚠️  No balance - liquidations requiring cbETH will fail)
💰 USDbC: 0.0 (⚠️  No balance - liquidations requiring USDbC will fail)
💰 DAI: 0.0 (⚠️  No balance - liquidations requiring DAI will fail)
```

### Successful Validation
```
info: Debt assets detected in position: {
  "borrower": "0x1234...",
  "protocol": "compound-v3",
  "debtAssets": [
    {
      "symbol": "USDC",
      "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "500.0"
    }
  ]
}

info: Wallet balance validation passed: {
  "borrower": "0x1234...",
  "debtToken": "USDC",
  "required": "250.0",
  "available": "1000.0",
  "balanceType": "token"
}
```

### Rejected Liquidation
```
warn: Liquidation rejected due to insufficient wallet balance: {
  "borrower": "0x1234...",
  "debtToken": "cbETH",
  "debtAsset": "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  "required": "0.5",
  "available": "0.0",
  "reason": "Insufficient cbETH balance: have 0, need 0.5",
  "flashLoanSuggested": true
}

info: 💡 Flash loan suggestion: {
  "borrower": "0x1234...",
  "debtToken": "cbETH",
  "debtAsset": "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  "required": "0.5",
  "suggestion": "Consider implementing flash loan liquidation to execute this opportunity without holding the debt token"
}
```

## Testing

Run the test script to verify functionality:

```bash
node test-wallet-balance.js
```

This will:
1. Check your wallet's current token balances
2. Test specific token balance validation
3. Verify ETH/WETH handling
4. Show example validation results

## Benefits

1. **Prevents Failed Transactions**: No more wasted gas on liquidations that will fail due to insufficient tokens
2. **Clear Visibility**: Know exactly what tokens your bot has and needs
3. **Flash Loan Guidance**: Get suggestions for implementing flash loans when capital is insufficient
4. **Configurable**: Can be disabled for testing or when using flash loans
5. **Comprehensive Logging**: Full transparency into balance validation decisions

## Next Steps

### Immediate
- ✅ Wallet balance validation implemented
- ✅ Comprehensive logging added
- ✅ Configuration options provided

### Future Enhancements
- Implement flash loan liquidations for zero-capital operations
- Add minimum balance thresholds per token
- Integrate with DEX price feeds for USD value calculations
- Add automatic token acquisition strategies

## Migration Notes

This change is **backward compatible** - existing bots will automatically get wallet balance validation with default settings. However, liquidations may now be rejected that previously would have been attempted (and failed).

To maintain the old behavior (attempt liquidations without balance checks), set:
```bash
ENABLE_WALLET_BALANCE_CHECK=false
```
