import { ethers } from 'ethers';
import Big from 'big.js';
import logger from '../../logger.js';

export class OpportunityValidator {
  constructor(provider) {
    this.provider = provider;
    this.minProfitThreshold = Big(process.env.MIN_PROFIT_THRESHOLD || '0.01');
    this.maxGasPrice = ethers.parseUnits(process.env.MAX_GAS_PRICE_GWEI || '50', 'gwei');
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30 seconds
  }

  async validate(liquidationEvent) {
    const startTime = Date.now();
    
    try {
      // Fast preliminary checks
      if (!this.isPreliminaryValid(liquidationEvent)) {
        return {
          isValid: false,
          reason: 'Failed preliminary validation'
        };
      }

      // Get user position data
      const positionData = await this.getUserPosition(liquidationEvent.borrower, liquidationEvent.protocol);
      
      if (!positionData) {
        return {
          isValid: false,
          reason: 'Could not fetch position data'
        };
      }

      // Calculate health factor
      const healthFactor = this.calculateHealthFactor(positionData);
      
      if (healthFactor.gte(1)) {
        return {
          isValid: false,
          reason: `Health factor too high: ${healthFactor.toString()}`
        };
      }

      // Calculate liquidation parameters
      const liquidationParams = await this.calculateLiquidationParams(
        liquidationEvent,
        positionData
      );

      // Estimate gas costs
      const gasCost = await this.estimateGasCost(liquidationParams);

      // Calculate expected profit
      const expectedProfit = liquidationParams.maxCollateralValue
        .minus(liquidationParams.debtValue)
        .minus(gasCost);

      // Validate profitability
      if (expectedProfit.lt(this.minProfitThreshold)) {
        return {
          isValid: false,
          reason: `Insufficient profit: ${expectedProfit.toString()}`
        };
      }

      const validationTime = Date.now() - startTime;
      
      logger.info('Opportunity validation successful:', {
        borrower: liquidationEvent.borrower,
        healthFactor: healthFactor.toString(),
        expectedProfit: expectedProfit.toString(),
        validationTime
      });

      return {
        isValid: true,
        healthFactor,
        expectedProfit,
        liquidationParams,
        gasCost,
        validationTime
      };

    } catch (error) {
      logger.error('Opportunity validation failed:', {
        borrower: liquidationEvent.borrower,
        error: error.message,
        validationTime: Date.now() - startTime
      });

      return {
        isValid: false,
        reason: `Validation error: ${error.message}`
      };
    }
  }

  isPreliminaryValid(event) {
    // Quick checks that don't require network calls
    if (!event.borrower || !ethers.isAddress(event.borrower)) {
      return false;
    }

    if (!event.protocol) {
      return false;
    }

    // Check if we've recently validated this borrower
    const cacheKey = `${event.borrower}-${event.protocol}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      logger.info(`Using cached validation for ${event.borrower}`);
      return cached.isValid;
    }

    return true;
  }

  async getUserPosition(borrower, protocol) {
    try {
      const cacheKey = `position-${borrower}-${protocol}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 5000) { // 5 second cache
        return cached.data;
      }

      let positionData;

      switch (protocol) {
        case 'compound-v3':
          positionData = await this.getCompoundV3Position(borrower);
          break;
        case 'aave-v3':
          positionData = await this.getAaveV3Position(borrower);
          break;
        default:
          logger.warn(`Unknown protocol: ${protocol}`);
          return null;
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: positionData,
        timestamp: Date.now()
      });

      return positionData;

    } catch (error) {
      logger.error('Error fetching user position:', error);
      return null;
    }
  }

  async getCompoundV3Position(borrower) {
    // Implementation for Compound V3 position fetching
    // This would interact with the actual Compound V3 contracts
    
    // Placeholder implementation
    return {
      collateralValue: Big('1000'),
      debtValue: Big('900'),
      collateralAssets: [
        {
          asset: '0x...', // ETH or other collateral
          amount: Big('1'),
          value: Big('1000')
        }
      ],
      debtAssets: [
        {
          asset: '0x...', // USDC or other debt
          amount: Big('900'),
          value: Big('900')
        }
      ],
      liquidationThreshold: Big('0.85')
    };
  }

  async getAaveV3Position(borrower) {
    // Implementation for Aave V3 position fetching
    // This would interact with the actual Aave V3 contracts
    
    // Placeholder implementation
    return {
      collateralValue: Big('1000'),
      debtValue: Big('900'),
      collateralAssets: [
        {
          asset: '0x...', // ETH or other collateral
          amount: Big('1'),
          value: Big('1000')
        }
      ],
      debtAssets: [
        {
          asset: '0x...', // USDC or other debt
          amount: Big('900'),
          value: Big('900')
        }
      ],
      liquidationThreshold: Big('0.85')
    };
  }

  calculateHealthFactor(positionData) {
    // Health Factor = (Collateral Value * Liquidation Threshold) / Debt Value
    const collateralValueThreshold = positionData.collateralValue
      .times(positionData.liquidationThreshold);
    
    if (positionData.debtValue.eq(0)) {
      return Big('999999'); // Effectively infinite
    }
    
    return collateralValueThreshold.div(positionData.debtValue);
  }

  async calculateLiquidationParams(event, positionData) {
    // Calculate maximum liquidation amounts based on protocol rules
    
    // Most protocols allow liquidating up to 50% of debt
    const maxDebtToLiquidate = positionData.debtValue.times('0.5');
    
    // Calculate corresponding collateral that can be seized
    // Usually with a liquidation bonus (e.g., 5-10%)
    const liquidationBonus = Big('0.05'); // 5% bonus
    const collateralToSeize = maxDebtToLiquidate.times(Big('1').plus(liquidationBonus));
    
    return {
      debtValue: maxDebtToLiquidate,
      maxCollateralValue: collateralToSeize,
      liquidationBonus,
      collateralAsset: positionData.collateralAssets[0]?.asset,
      debtAsset: positionData.debtAssets[0]?.asset
    };
  }

  async estimateGasCost(liquidationParams) {
    try {
      // Estimate gas usage for liquidation transaction
      // This is a rough estimate - you'd want to do actual gas estimation
      const estimatedGasUnits = 300000; // Typical liquidation gas usage
      
      // Get current gas price (this would come from GasOracle in real implementation)
      const gasPrice = await this.provider.getFeeData();
      const gasCost = Big(estimatedGasUnits.toString())
        .times(gasPrice.gasPrice.toString())
        .div('1e18'); // Convert to ETH
      
      return gasCost;
      
    } catch (error) {
      logger.error('Error estimating gas cost:', error);
      // Return conservative estimate
      return Big('0.01'); // 0.01 ETH
    }
  }

  clearCache() {
    this.cache.clear();
  }

  setCacheTimeout(timeout) {
    this.cacheTimeout = timeout;
  }
}
