import { ethers } from 'ethers';
import logger from '../../logger.js';

export class TransactionExecutor {
  constructor(wallet, gasOracle) {
    this.wallet = wallet;
    this.gasOracle = gasOracle;
    this.nonce = null;
    this.nonceManager = new NonceManager(wallet);
    this.transactionQueue = [];
    this.isExecuting = false;
    this.maxConcurrentTx = parseInt(process.env.MAX_CONCURRENT_LIQUIDATIONS || '3');
    this.timeoutMs = parseInt(process.env.LIQUIDATION_TIMEOUT_MS || '200');
  }

  async executeLiquidation(event, validation, gasPrice) {
    const startTime = Date.now();
    
    try {
      // Pre-build transaction for speed
      const transaction = await this.buildLiquidationTransaction(
        event,
        validation,
        gasPrice
      );
      
      // Get nonce quickly
      const nonce = await this.nonceManager.getNextNonce();
      transaction.nonce = nonce;
      
      // Sign transaction
      const signedTx = await this.wallet.signTransaction(transaction);
      
      // Submit transaction
      const response = await this.wallet.provider.broadcastTransaction(signedTx);
      
      const executionTime = Date.now() - startTime;
      
      if (executionTime > this.timeoutMs) {
        logger.warn(`Liquidation execution slow: ${executionTime}ms > ${this.timeoutMs}ms`);
      }
      
      logger.transaction({
        event: 'submitted',
        txHash: response.hash,
        borrower: event.borrower,
        executionTime,
        nonce,
        gasPrice: gasPrice.toString()
      });
      
      return response.hash;
      
    } catch (error) {
      // Release nonce on failure
      this.nonceManager.releaseNonce();
      
      logger.error('Transaction execution failed:', {
        borrower: event.borrower,
        error: error.message,
        executionTime: Date.now() - startTime
      });
      
      throw error;
    }
  }

  async buildLiquidationTransaction(event, validation, gasPrice) {
    const { liquidationParams } = validation;
    
    try {
      let transaction;
      
      switch (event.protocol) {
        case 'compound-v3':
          transaction = await this.buildCompoundV3Transaction(event, liquidationParams);
          break;
        case 'aave-v3':
          transaction = await this.buildAaveV3Transaction(event, liquidationParams);
          break;
        default:
          throw new Error(`Unsupported protocol: ${event.protocol}`);
      }
      
      // Add gas parameters
      transaction.gasPrice = gasPrice;
      transaction.gasLimit = this.estimateGasLimit(event.protocol);
      
      // Set type 2 transaction for Base L2 (EIP-1559)
      if (gasPrice.maxFeePerGas) {
        transaction.type = 2;
        transaction.maxFeePerGas = gasPrice.maxFeePerGas;
        transaction.maxPriorityFeePerGas = gasPrice.maxPriorityFeePerGas;
        delete transaction.gasPrice;
      }
      
      return transaction;
      
    } catch (error) {
      logger.error('Failed to build liquidation transaction:', error);
      throw error;
    }
  }

  async buildCompoundV3Transaction(event, liquidationParams) {
    // Build Compound V3 liquidation transaction
    // This would interact with the actual Compound V3 liquidation function
    
    const compoundV3Interface = new ethers.Interface([
      "function absorb(address asset, address[] accounts)"
    ]);
    
    const data = compoundV3Interface.encodeFunctionData("absorb", [
      liquidationParams.debtAsset,
      [event.borrower]
    ]);
    
    return {
      to: process.env.COMPOUND_V3_ADDRESS, // Would be the actual contract address
      data,
      value: 0
    };
  }

  async buildAaveV3Transaction(event, liquidationParams) {
    // Build Aave V3 liquidation transaction
    
    // Debug log the exact values being passed to the transaction encoder
    logger.info('🏗️ Building Aave V3 transaction with params:', {
      borrower: event.borrower,
      collateralAsset: liquidationParams.collateralAsset,
      debtAsset: liquidationParams.debtAsset,
      debtValue: liquidationParams.debtValue.toString(),
      collateralAssetType: typeof liquidationParams.collateralAsset,
      debtAssetType: typeof liquidationParams.debtAsset,
      collateralAssetLength: liquidationParams.collateralAsset ? liquidationParams.collateralAsset.length : 0,
      debtAssetLength: liquidationParams.debtAsset ? liquidationParams.debtAsset.length : 0,
      collateralAssetValid: ethers.isAddress(liquidationParams.collateralAsset || ''),
      debtAssetValid: ethers.isAddress(liquidationParams.debtAsset || '')
    });
    
    // Validate addresses before encoding
    if (!liquidationParams.collateralAsset || !ethers.isAddress(liquidationParams.collateralAsset)) {
      throw new Error(`Invalid collateral asset address: "${liquidationParams.collateralAsset}"`);
    }
    
    if (!liquidationParams.debtAsset || !ethers.isAddress(liquidationParams.debtAsset)) {
      throw new Error(`Invalid debt asset address: "${liquidationParams.debtAsset}"`);
    }
    
    const aaveV3Interface = new ethers.Interface([
      "function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)"
    ]);
    
    const data = aaveV3Interface.encodeFunctionData("liquidationCall", [
      liquidationParams.collateralAsset,
      liquidationParams.debtAsset,
      event.borrower,
      liquidationParams.debtValue.toString(),
      false // Receive underlying asset, not aToken
    ]);
    
    return {
      to: process.env.AAVE_V3_POOL_ADDRESS, // Would be the actual contract address
      data,
      value: 0
    };
  }

  estimateGasLimit(protocol) {
    // Conservative gas limits by protocol
    const gasLimits = {
      'compound-v3': 400000,
      'aave-v3': 500000,
      'default': 600000
    };
    
    return gasLimits[protocol] || gasLimits.default;
  }

  async executeFlashLoan(borrowAmount, asset, liquidationData) {
    // Implementation for flash loan liquidations
    // This would be used for liquidations where the bot doesn't have enough capital
    
    logger.info('Executing flash loan liquidation:', {
      borrowAmount: borrowAmount.toString(),
      asset
    });
    
    // This would implement actual flash loan logic
    // Could use Aave flash loans, Uniswap flash swaps, etc.
    
    throw new Error('Flash loan liquidation not implemented yet');
  }
}

class NonceManager {
  constructor(wallet) {
    this.wallet = wallet;
    this.currentNonce = null;
    this.pendingNonces = new Set();
    this.lastUpdate = 0;
    this.updateInterval = 10000; // Update nonce every 10 seconds
  }

  async getNextNonce() {
    try {
      // Update nonce if stale
      if (!this.currentNonce || Date.now() - this.lastUpdate > this.updateInterval) {
        await this.updateNonce();
      }
      
      // Find next available nonce
      let nextNonce = this.currentNonce;
      while (this.pendingNonces.has(nextNonce)) {
        nextNonce++;
      }
      
      this.pendingNonces.add(nextNonce);
      return nextNonce;
      
    } catch (error) {
      logger.error('Error getting next nonce:', error);
      // Fallback to provider nonce
      return await this.wallet.provider.getTransactionCount(
        this.wallet.address,
        'pending'
      );
    }
  }

  async updateNonce() {
    try {
      this.currentNonce = await this.wallet.provider.getTransactionCount(
        this.wallet.address,
        'pending'
      );
      this.lastUpdate = Date.now();
      
    } catch (error) {
      logger.error('Error updating nonce:', error);
    }
  }

  releaseNonce(nonce) {
    if (nonce !== undefined) {
      this.pendingNonces.delete(nonce);
    }
  }

  confirmNonce(nonce) {
    this.pendingNonces.delete(nonce);
    
    // Clean up any nonces below confirmed nonce
    for (const pendingNonce of this.pendingNonces) {
      if (pendingNonce <= nonce) {
        this.pendingNonces.delete(pendingNonce);
      }
    }
  }
}
