import { ethers } from 'ethers';
import Big from 'big.js';
import { PriceOracle } from './PriceOracle.js';
import logger from '../../logger.js';

export class OpportunityValidator {
  constructor(provider) {
    this.provider = provider;
    this.minProfitThreshold = Big(process.env.MIN_PROFIT_THRESHOLD || '0.01');
    this.maxGasPrice = ethers.parseUnits(process.env.MAX_GAS_PRICE_GWEI || '50', 'gwei');
    this.cache = new Map();
    this.positionCacheTimeout = 30000; // 30 seconds for position data
    this.balanceCacheTimeout = 15000; // 15 seconds for balance data
    this.balanceCache = new Map(); // Separate cache for wallet balances
    
    // Initialize PriceOracle for real-time price feeds
    this.priceOracle = new PriceOracle(provider);
    
    // Token address to symbol mapping for Base mainnet
    this.tokenSymbols = {
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 'USDC',
      '0x4200000000000000000000000000000000000006': 'WETH',
      '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22': 'cbETH',
      '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA': 'USDbC',
      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb': 'DAI',
      '0xB79DD08EA68A908A97220C76d19A6aA9cBDD4376': 'USD+',
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631': 'AERO',
      // Add more as needed
    };

    // Wallet address for balance checks - will be set by LiquidationBot
    this.walletAddress = null;
    
    // Configuration for wallet balance validation
    this.enableWalletBalanceCheck = process.env.ENABLE_WALLET_BALANCE_CHECK !== 'false'; // Default to enabled
    this.suggestFlashLoans = process.env.SUGGEST_FLASH_LOANS === 'true'; // Default to disabled
    
    // ERC-20 ABI for token balance checking
    this.erc20ABI = [
      'function balanceOf(address owner) external view returns (uint256)',
      'function decimals() external view returns (uint8)',
      'function symbol() external view returns (string)'
    ];
  }

  getTokenSymbol(address) {
    if (!address) return 'UNKNOWN';
    const symbol = this.tokenSymbols[address.toLowerCase()] || this.tokenSymbols[address];
    return symbol || `${address.slice(0, 6)}...${address.slice(-4)}`;
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

      // Log detected debt assets for transparency
      if (positionData.debtAssets && positionData.debtAssets.length > 0) {
        logger.info('Debt assets detected in position:', {
          borrower: liquidationEvent.borrower,
          protocol: liquidationEvent.protocol,
          debtAssets: positionData.debtAssets.map(asset => ({
            symbol: asset.symbol,
            address: asset.asset,
            tokenAmount: asset.amount?.toString(),
            underlyingToken: asset.underlyingSymbol || 'unknown'
          })),
          totalDebtValueUSD: positionData.debtValue?.toString(),
          note: "USD values use real-time price feeds with 2min cache"
        });
      }

      // CRITICAL: Check wallet balance for debt token before proceeding
      const debtAssetAddress = liquidationEvent.debtAsset || liquidationParams.debtAsset;
      const debtAmount = liquidationParams.debtValue;
      
      // Skip wallet balance validation if disabled
      if (!this.enableWalletBalanceCheck) {
        logger.warn('Wallet balance validation is DISABLED - liquidation may fail due to insufficient funds');
      } else if (debtAssetAddress && debtAmount) {
        const balanceCheck = await this.checkWalletTokenBalance(debtAssetAddress, debtAmount);
        
        if (!balanceCheck.hasBalance) {
          const reason = balanceCheck.error 
            ? `Wallet balance check failed: ${balanceCheck.error}`
            : `Insufficient ${balanceCheck.symbol} balance: have ${balanceCheck.walletBalance || '0'}, need ${balanceCheck.required}`;
          
          // Suggest flash loan if enabled
          if (this.suggestFlashLoans) {
            logger.info('💡 Flash loan suggestion:', {
              borrower: liquidationEvent.borrower,
              debtToken: balanceCheck.symbol,
              debtAsset: debtAssetAddress,
              required: debtAmount.toString(),
              suggestion: 'Consider implementing flash loan liquidation to execute this opportunity without holding the debt token'
            });
          }
          
          logger.warn('Liquidation rejected due to insufficient wallet balance:', {
            borrower: liquidationEvent.borrower,
            debtToken: balanceCheck.symbol,
            debtAsset: debtAssetAddress,
            required: debtAmount.toString(),
            available: balanceCheck.walletBalance?.toString() || 'unknown',
            reason,
            flashLoanSuggested: this.suggestFlashLoans
          });
          
          return {
            isValid: false,
            reason
          };
        }

        logger.info('Wallet balance validation passed:', {
          borrower: liquidationEvent.borrower,
          debtToken: balanceCheck.symbol,
          required: debtAmount.toString(),
          available: balanceCheck.walletBalance.toString(),
          balanceType: balanceCheck.balanceType
        });
      } else {
        // Fallback: check if we have any of the debt tokens from position
        if (positionData.debtAssets && positionData.debtAssets.length > 0) {
          const allBalancesCheck = await this.checkAllDebtTokenBalances(positionData.debtAssets);
          
          if (!allBalancesCheck.allBalancesOk) {
            logger.warn('Liquidation rejected - insufficient balance for any debt tokens:', {
              borrower: liquidationEvent.borrower,
              balanceDetails: allBalancesCheck.balanceDetails
            });
            
            return {
              isValid: false,
              reason: 'Insufficient wallet balance for required debt tokens'
            };
          }
          
          logger.info('Wallet has sufficient balance for debt tokens:', {
            borrower: liquidationEvent.borrower,
            balanceDetails: allBalancesCheck.balanceDetails
          });
        } else {
          logger.warn('Could not determine debt asset for wallet balance validation', {
            borrower: liquidationEvent.borrower,
            debtAsset: debtAssetAddress,
            hasDebtAmount: !!debtAmount,
            hasPositionDebtAssets: !!(positionData.debtAssets && positionData.debtAssets.length > 0)
          });
        }
      }

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
      
      // Get token symbols for better readability
      const debtTokenSymbol = this.getTokenSymbol(liquidationEvent.debtAsset || liquidationParams.debtAsset);
      const collateralTokenSymbol = this.getTokenSymbol(liquidationEvent.collateralAsset || liquidationParams.collateralAsset);
      
      logger.info('Opportunity validation successful:', {
        borrower: liquidationEvent.borrower,
        protocol: liquidationEvent.protocol,
        debtToken: debtTokenSymbol,
        collateralToken: collateralTokenSymbol,
        debtAssetAddress: liquidationEvent.debtAsset || liquidationParams.debtAsset,
        collateralAssetAddress: liquidationEvent.collateralAsset || liquidationParams.collateralAsset,
        healthFactor: healthFactor.toString(),
        expectedProfit: expectedProfit.toString(),
        debtValue: liquidationParams.debtValue.toString(),
        maxCollateralValue: liquidationParams.maxCollateralValue.toString(),
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
      
      if (cached && Date.now() - cached.timestamp < this.positionCacheTimeout) { // Extended to 30 seconds
        logger.debug(`Using cached position data for ${borrower} (${protocol})`);
        return cached.data;
      }

      let positionData;

      switch (protocol) {
        case 'compound-v3':
          positionData = await this.getCompoundV3Position(borrower);
          break;
        case 'aave-v3':
        case 'aave':
          positionData = await this.getAaveV3Position(borrower);
          break;
        case 'moonwell':
          positionData = await this.getMoonwellPosition(borrower);
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
    try {
      // Compound V3 Comet contract addresses on Base mainnet
      const cometContracts = {
        'USDC': '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        'ETH': '0x46e6b214b524310239732D51387075E0e70970bf'
      };

      // Comet ABI for position queries
      const cometABI = [
        'function balanceOf(address account) external view returns (int256)',
        'function borrowBalanceOf(address account) external view returns (uint256)',
        'function collateralBalanceOf(address account, address asset) external view returns (uint128)',
        'function isLiquidatable(address account) external view returns (bool)',
        'function getAssetInfo(uint8 i) external view returns (uint8 offset, address asset, address priceFeed, uint128 scale, uint128 borrowCollateralFactor, uint128 liquidateCollateralFactor, uint128 liquidationFactor, uint128 supplyCap)',
        'function numAssets() external view returns (uint8)',
        'function baseToken() external view returns (address)',
        'function getUtilization() external view returns (uint256)',
        'function getSupplyRate(uint256 utilization) external view returns (uint256)',
        'function getBorrowRate(uint256 utilization) external view returns (uint256)'
      ];

      const collateralAssets = [];
      const debtAssets = [];
      let totalCollateralValue = Big('0');
      let totalDebtValue = Big('0');

      // Check both USDC and ETH markets
      for (const [symbol, address] of Object.entries(cometContracts)) {
        try {
          const cometContract = new ethers.Contract(address, cometABI, this.provider);
          
          // Get base asset balance (negative = debt, positive = supply)
          const baseBalance = await cometContract.balanceOf(borrower);
          const baseBalanceBig = Big(baseBalance.toString());
          
          // Get base token address
          const baseToken = await cometContract.baseToken();
          
          if (baseBalanceBig.lt(0)) {
            // User has debt in this market
            const debtAmount = baseBalanceBig.abs();
            const decimals = symbol === 'USDC' ? 6 : 18;
            const debtInUnits = debtAmount.div(`1e${decimals}`);
            
            debtAssets.push({
              asset: baseToken,
              symbol,
              amount: debtInUnits,
              market: address
            });

            // Calculate USD value using real-time prices
            const usdValue = await this.priceOracle.calculateUSDValue(baseToken, debtInUnits);
            totalDebtValue = totalDebtValue.plus(usdValue);
            
            logger.info(`Compound V3 debt in ${symbol} market:`, {
              tokenAmount: debtInUnits.toString(),
              usdValue: usdValue.toString(),
              priceSource: 'PriceOracle (real-time)'
            });
          } else if (baseBalanceBig.gt(0)) {
            // User has supplied base asset
            const decimals = symbol === 'USDC' ? 6 : 18;
            const supplyInUnits = baseBalanceBig.div(`1e${decimals}`);
            
            collateralAssets.push({
              asset: baseToken,
              symbol,
              amount: supplyInUnits,
              market: address
            });

            // Calculate USD value using real-time prices
            const usdValue = await this.priceOracle.calculateUSDValue(baseToken, supplyInUnits);
            totalCollateralValue = totalCollateralValue.plus(usdValue);
          }

          // Check collateral assets in this market
          const numAssets = await cometContract.numAssets();
          
          for (let i = 0; i < numAssets; i++) {
            try {
              const assetInfo = await cometContract.getAssetInfo(i);
              const collateralBalance = await cometContract.collateralBalanceOf(borrower, assetInfo.asset);
              
              if (collateralBalance > 0n) {
                // Determine asset symbol based on address
                let assetSymbol = 'UNKNOWN';
                if (assetInfo.asset.toLowerCase() === '0x4200000000000000000000000000000000000006') {
                  assetSymbol = 'WETH';
                } else if (assetInfo.asset.toLowerCase() === '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22') {
                  assetSymbol = 'cbETH';
                }

                const decimals = 18; // Most collateral assets are 18 decimals
                const amount = Big(collateralBalance.toString()).div(`1e${decimals}`);
                
                collateralAssets.push({
                  asset: assetInfo.asset,
                  symbol: assetSymbol,
                  amount,
                  market: address,
                  borrowCollateralFactor: Big(assetInfo.borrowCollateralFactor.toString()).div('1e18'),
                  liquidateCollateralFactor: Big(assetInfo.liquidateCollateralFactor.toString()).div('1e18')
                });

                // Calculate USD value using real-time prices
                const usdValue = await this.priceOracle.calculateUSDValue(assetInfo.asset, amount);
                totalCollateralValue = totalCollateralValue.plus(usdValue);
              }
            } catch (error) {
              logger.warn(`Failed to fetch collateral asset ${i} for ${symbol} market:`, error.message);
            }
          }

          // Check if account is liquidatable
          const isLiquidatable = await cometContract.isLiquidatable(borrower);
          if (isLiquidatable) {
            logger.warn(`Account ${borrower} is liquidatable in ${symbol} market!`);
          }

        } catch (error) {
          logger.warn(`Failed to fetch Compound V3 ${symbol} position for ${borrower}:`, error.message);
        }
      }

      // Calculate health factor
      let healthFactor = Big('999999');
      if (totalDebtValue.gt(0)) {
        // For Compound V3, health factor is roughly collateral value / debt value
        // Liquidation typically happens around 1.0
        healthFactor = totalCollateralValue.div(totalDebtValue);
      }

      logger.info(`Compound V3 position for ${borrower}:`, {
        totalCollateralValue: totalCollateralValue.toString(),
        totalDebtValue: totalDebtValue.toString(),
        healthFactor: healthFactor.toString(),
        collateralAssets: collateralAssets.length,
        debtAssets: debtAssets.length
      });

      return {
        collateralValue: totalCollateralValue,
        debtValue: totalDebtValue,
        collateralAssets,
        debtAssets,
        liquidationThreshold: Big('0.83'), // Compound V3 typical threshold
        healthFactor,
        protocol: 'compound-v3'
      };

    } catch (error) {
      logger.error(`Error fetching Compound V3 position for ${borrower}:`, error);
      return null;
    }
  }

  async getAaveV3Position(borrower) {
    try {
      // Aave V3 Pool contract on Base
      const poolAddress = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
      const poolABI = [
        'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
        'function getUserConfiguration(address user) external view returns (uint256)',
        'function getReserveData(address asset) external view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)'
      ];

      const poolContract = new ethers.Contract(poolAddress, poolABI, this.provider);
      
      // Get user account data
      const accountData = await poolContract.getUserAccountData(borrower);
      
      // Convert from base units (8 decimals) to standard units
      const totalCollateralETH = Big(accountData.totalCollateralBase.toString()).div('1e8');
      const totalDebtETH = Big(accountData.totalDebtBase.toString()).div('1e8');
      const healthFactor = Big(accountData.healthFactor.toString()).div('1e18');
      const liquidationThreshold = Big(accountData.currentLiquidationThreshold.toString()).div('1e4'); // basis points to decimal

      // Most common tokens on Base Aave V3
      const commonTokens = {
        'WETH': '0x4200000000000000000000000000000000000006',
        'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        'cbETH': '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
        'USDbC': '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'
      };

      // Get detailed position for major tokens
      const collateralAssets = [];
      const debtAssets = [];

      for (const [symbol, address] of Object.entries(commonTokens)) {
        try {
          const reserveData = await poolContract.getReserveData(address);
          const aTokenAddress = reserveData.aTokenAddress;
          const variableDebtTokenAddress = reserveData.variableDebtTokenAddress;

          // AToken ABI for collateral balance
          const aTokenABI = ['function balanceOf(address) external view returns (uint256)'];
          const aTokenContract = new ethers.Contract(aTokenAddress, aTokenABI, this.provider);
          
          // Variable debt token ABI for debt balance
          const debtTokenContract = new ethers.Contract(variableDebtTokenAddress, aTokenABI, this.provider);

          const collateralBalance = await aTokenContract.balanceOf(borrower);
          const debtBalance = await debtTokenContract.balanceOf(borrower);

          // Get token decimals
          const decimals = symbol === 'USDC' || symbol === 'USDbC' ? 6 : 18;
          
          if (collateralBalance > 0n) {
            collateralAssets.push({
              asset: address,
              symbol,
              amount: Big(collateralBalance.toString()).div(`1e${decimals}`),
              aTokenAddress
            });
          }

          if (debtBalance > 0n) {
            debtAssets.push({
              asset: address,
              symbol,
              amount: Big(debtBalance.toString()).div(`1e${decimals}`),
              debtTokenAddress: variableDebtTokenAddress
            });
          }

        } catch (error) {
          logger.warn(`Failed to fetch ${symbol} position for ${borrower}:`, error.message);
        }
      }

      logger.info(`Aave V3 position for ${borrower}:`, {
        totalCollateralETH: totalCollateralETH.toString(),
        totalDebtETH: totalDebtETH.toString(),
        healthFactor: healthFactor.toString(),
        collateralAssets: collateralAssets.length,
        debtAssets: debtAssets.length
      });

      return {
        collateralValue: totalCollateralETH,
        debtValue: totalDebtETH,
        collateralAssets,
        debtAssets,
        liquidationThreshold,
        healthFactor,
        protocol: 'aave-v3'
      };

    } catch (error) {
      logger.error(`Error fetching Aave V3 position for ${borrower}:`, error);
      return null;
    }
  }

  async getMoonwellPosition(borrower) {
    try {
      // Moonwell uses Compound V2-style contracts
      // Main markets on Base
      const markets = {
        'USDC': '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
        'WETH': '0x628ff693426583D9a7FB391E54366292F509D457',
        'cbETH': '0x0dc808adcE2099A9F62AA87D9670745AbA741746',
        'EURC': '0xF877ACaAE7b5459b9B14dCd8c61cBb2A4F7E1c79'
      };

      // Moonwell Comptroller for account liquidity
      const comptrollerAddress = '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C';
      const comptrollerABI = [
        'function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256)'
      ];

      // cToken ABI for individual market data
      const cTokenABI = [
        'function balanceOf(address) external view returns (uint256)',
        'function borrowBalanceStored(address) external view returns (uint256)',
        'function exchangeRateStored() external view returns (uint256)',
        'function underlying() external view returns (address)',
        'function symbol() external view returns (string)'
      ];

      const comptroller = new ethers.Contract(comptrollerAddress, comptrollerABI, this.provider);
      
      // Get account liquidity (returns: error, liquidity, shortfall)
      const [, liquidity, shortfall] = await comptroller.getAccountLiquidity(borrower);
      
      const collateralAssets = [];
      const debtAssets = [];
      let totalCollateralValue = Big('0');
      let totalDebtValue = Big('0');

      for (const [symbol, marketAddress] of Object.entries(markets)) {
        try {
          const cTokenContract = new ethers.Contract(marketAddress, cTokenABI, this.provider);
          
          const cTokenBalance = await cTokenContract.balanceOf(borrower);
          const borrowBalance = await cTokenContract.borrowBalanceStored(borrower);
          const exchangeRate = await cTokenContract.exchangeRateStored();

          if (cTokenBalance > 0n) {
            // Calculate underlying token amount
            const underlyingAmount = Big(cTokenBalance.toString())
              .times(exchangeRate.toString())
              .div('1e18');

            // Convert to standard decimals
            const decimals = symbol === 'USDC' || symbol === 'EURC' ? 6 : 18;
            const amount = underlyingAmount.div(`1e${decimals}`);

            collateralAssets.push({
              asset: marketAddress,
              symbol: `m${symbol}`,
              amount,
              underlyingSymbol: symbol
            });

            // Calculate USD value using real-time prices
            // Use the underlying token address for price lookup
            const underlyingTokenAddress = symbol === 'USDC' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' :
                                         symbol === 'WETH' ? '0x4200000000000000000000000000000000000006' :
                                         symbol === 'cbETH' ? '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' :
                                         symbol === 'EURC' ? '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' : null;
            
            const estimatedValue = underlyingTokenAddress ? 
              await this.priceOracle.calculateUSDValue(underlyingTokenAddress, amount) : 
              amount; // Fallback to 1:1 for unknown tokens
            
            totalCollateralValue = totalCollateralValue.plus(estimatedValue);
          }

          if (borrowBalance > 0n) {
            const decimals = symbol === 'USDC' || symbol === 'EURC' ? 6 : 18;
            const amount = Big(borrowBalance.toString()).div(`1e${decimals}`);

            debtAssets.push({
              asset: marketAddress,
              symbol: `m${symbol}`,
              amount,
              underlyingSymbol: symbol
            });

            // Calculate USD value using real-time prices
            const underlyingTokenAddress = symbol === 'USDC' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' :
                                         symbol === 'WETH' ? '0x4200000000000000000000000000000000000006' :
                                         symbol === 'cbETH' ? '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' :
                                         symbol === 'EURC' ? '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' : null;
            
            const estimatedValue = underlyingTokenAddress ? 
              await this.priceOracle.calculateUSDValue(underlyingTokenAddress, amount) : 
              amount; // Fallback to 1:1 for unknown tokens
            
            totalDebtValue = totalDebtValue.plus(estimatedValue);
            
            // Log individual debt asset with real-time price info
            const tokenPrice = underlyingTokenAddress ? 
              await this.priceOracle.getTokenPrice(underlyingTokenAddress) : Big('1');
            
            logger.info(`Moonwell debt asset for ${borrower}:`, {
              symbol: `m${symbol}`,
              tokenAmount: amount.toString(),
              estimatedUSD: estimatedValue.toString(),
              tokenPrice: tokenPrice.toString(),
              priceSource: 'PriceOracle (real-time)'
            });
          }

        } catch (error) {
          logger.warn(`Failed to fetch Moonwell ${symbol} position for ${borrower}:`, error.message);
        }
      }

      // Calculate health factor from liquidity/shortfall
      let healthFactor = Big('999999'); // Default to very high
      if (totalDebtValue.gt(0)) {
        if (shortfall > 0n) {
          // Account is underwater
          healthFactor = Big('0.95'); // Just below liquidation threshold
        } else {
          // Healthy account
          const liquidityValue = Big(liquidity.toString()).div('1e18');
          healthFactor = totalCollateralValue.div(totalDebtValue);
        }
      }

      logger.info(`Moonwell position for ${borrower}:`, {
        totalCollateralValueUSD: totalCollateralValue.toString(),
        totalDebtValueUSD: totalDebtValue.toString(),
        healthFactor: healthFactor.toString(),
        liquidityETH: ethers.formatEther(liquidity),
        shortfallETH: ethers.formatEther(shortfall),
        collateralAssets: collateralAssets.length,
        debtAssets: debtAssets.length,
        priceSource: 'PriceOracle (real-time feeds with 2min cache)'
      });

      return {
        collateralValue: totalCollateralValue,
        debtValue: totalDebtValue,
        collateralAssets,
        debtAssets,
        liquidationThreshold: Big('0.80'), // Moonwell typical LTV
        healthFactor,
        protocol: 'moonwell'
      };

    } catch (error) {
      logger.error(`Error fetching Moonwell position for ${borrower}:`, error);
      return null;
    }
  }

  calculateHealthFactor(positionData) {
    // If the position data already includes a health factor (from protocol), use it
    if (positionData.healthFactor) {
      return positionData.healthFactor;
    }

    // Otherwise calculate: Health Factor = (Collateral Value * Liquidation Threshold) / Debt Value
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
    
    // Extract asset addresses with debugging
    const collateralAsset = positionData.collateralAssets[0]?.asset;
    const debtAsset = positionData.debtAssets[0]?.asset;
    
    // Debug log to identify the address issue
    logger.info('🔍 Address extraction debug:', {
      borrower: event.borrower,
      protocol: positionData.protocol,
      collateralAsset,
      debtAsset,
      collateralAssetType: typeof collateralAsset,
      debtAssetType: typeof debtAsset,
      collateralAssetLength: collateralAsset ? collateralAsset.length : 0,
      debtAssetLength: debtAsset ? debtAsset.length : 0,
      collateralAssetValid: ethers.isAddress(collateralAsset || ''),
      debtAssetValid: ethers.isAddress(debtAsset || ''),
      numCollateralAssets: positionData.collateralAssets?.length || 0,
      numDebtAssets: positionData.debtAssets?.length || 0,
      fullCollateralAssets: positionData.collateralAssets,
      fullDebtAssets: positionData.debtAssets
    });
    
    return {
      debtValue: maxDebtToLiquidate,
      maxCollateralValue: collateralToSeize,
      liquidationBonus,
      collateralAsset,
      debtAsset
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

  async checkWalletBalances(debtAssets, totalDebtValue) {
    try {
      if (!this.walletAddress) {
        throw new Error('Wallet address not set');
      }

      let totalBalance = Big('0');

      for (const debtAsset of debtAssets) {
        try {
          const tokenContract = new ethers.Contract(debtAsset.asset, this.erc20ABI, this.provider);
          const balance = await tokenContract.balanceOf(this.walletAddress);
          const decimals = await tokenContract.decimals();
          const symbol = await tokenContract.symbol();

          const balanceInUnits = Big(balance.toString()).div(`1e${decimals}`);
          
          logger.info(`Wallet balance for ${symbol}: ${balanceInUnits.toString()}`);

          totalBalance = totalBalance.plus(balanceInUnits);

        } catch (error) {
          logger.warn(`Failed to fetch balance for debt asset ${debtAsset.asset}:`, error.message);
        }
      }

      logger.info(`Total wallet balance for debt assets: ${totalBalance.toString()}`);

      // Check if total balance covers the total debt value
      return totalBalance.gte(totalDebtValue);

    } catch (error) {
      logger.error('Error checking wallet balances:', error);
      return false;
    }
  }

  /**
   * Clear cached data to ensure fresh data for critical operations
   * @param {string} type - 'position', 'balance', or 'all'
   * @param {string} borrower - Optional specific borrower to clear
   */
  clearCache(type = 'all', borrower = null) {
    const now = Date.now();
    
    if (type === 'position' || type === 'all') {
      if (borrower) {
        // Clear position cache for specific borrower
        for (const key of this.cache.keys()) {
          if (key.includes(`position-${borrower}-`)) {
            this.cache.delete(key);
          }
        }
        logger.debug(`Cleared position cache for borrower: ${borrower}`);
      } else {
        // Clear all position cache
        for (const key of this.cache.keys()) {
          if (key.includes('position-')) {
            this.cache.delete(key);
          }
        }
        logger.debug('Cleared all position cache');
      }
    }
    
    if (type === 'balance' || type === 'all') {
      // Clear balance cache
      this.balanceCache.clear();
      logger.debug('Cleared balance cache');
    }
    
    // Clean up expired entries
    this.cleanupExpiredCache();
  }

  /**
   * Remove expired cache entries
   */
  cleanupExpiredCache() {
    const now = Date.now();
    
    // Clean position cache
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.positionCacheTimeout) {
        this.cache.delete(key);
      }
    }
    
    // Clean balance cache
    for (const [key, value] of this.balanceCache.entries()) {
      if (now - value.timestamp > this.balanceCacheTimeout) {
        this.balanceCache.delete(key);
      }
    }
  }

  // Set wallet address for balance validation
  setWalletAddress(walletAddress) {
    this.walletAddress = walletAddress;
  }

  /**
   * Check if the bot's wallet has sufficient balance of the debt token to execute liquidation
   * @param {string} debtAssetAddress - Address of the debt token
   * @param {Big} debtAmount - Amount of debt token needed for liquidation
   * @returns {Object} - { hasBalance: boolean, walletBalance: Big, required: Big, symbol: string }
   */
  async checkWalletTokenBalance(debtAssetAddress, debtAmount) {
    if (!this.walletAddress) {
      logger.warn('Wallet address not set for balance validation');
      return { hasBalance: false, reason: 'Wallet address not configured' };
    }

    // Check cache first
    const cacheKey = `balance-${this.walletAddress}-${debtAssetAddress}`;
    const cached = this.balanceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.balanceCacheTimeout) {
      logger.debug(`Using cached wallet balance for ${debtAssetAddress}`);
      // Recalculate hasBalance with current debtAmount
      const hasBalance = cached.walletBalance.gte(debtAmount);
      return {
        ...cached,
        hasBalance,
        required: debtAmount
      };
    }

    try {
      const symbol = this.getTokenSymbol(debtAssetAddress);
      
      // Handle WETH special case - check both WETH and ETH balances
      if (debtAssetAddress.toLowerCase() === '0x4200000000000000000000000000000000000006') {
        // Check ETH balance
        const ethBalance = await this.provider.getBalance(this.walletAddress);
        const ethBalanceBig = Big(ethBalance.toString()).div('1e18');
        
        if (ethBalanceBig.gte(debtAmount)) {
          logger.info(`Sufficient ETH balance for liquidation:`, {
            required: debtAmount.toString(),
            available: ethBalanceBig.toString(),
            token: 'ETH'
          });
          
          const result = { 
            hasBalance: true, 
            walletBalance: ethBalanceBig, 
            required: debtAmount, 
            symbol: 'ETH',
            balanceType: 'native'
          };

          // Cache ETH balance
          this.balanceCache.set(cacheKey, {
            walletBalance: ethBalanceBig,
            symbol: 'ETH',
            balanceType: 'native',
            timestamp: Date.now()
          });

          return result;
        }
      }

      // Check ERC-20 token balance
      const tokenContract = new ethers.Contract(debtAssetAddress, this.erc20ABI, this.provider);
      const tokenBalance = await tokenContract.balanceOf(this.walletAddress);
      
      // Get token decimals to convert balance properly
      let decimals = 18; // Default
      try {
        decimals = await tokenContract.decimals();
      } catch (error) {
        // Use known decimals for common tokens
        if (['USDC', 'USDbC'].includes(symbol)) {
          decimals = 6;
        }
      }

      const tokenBalanceBig = Big(tokenBalance.toString()).div(`1e${decimals}`);
      const hasBalance = tokenBalanceBig.gte(debtAmount);

      logger.info(`Wallet token balance check:`, {
        token: symbol,
        address: debtAssetAddress,
        required: debtAmount.toString(),
        available: tokenBalanceBig.toString(),
        hasBalance,
        decimals
      });

      const result = { 
        hasBalance, 
        walletBalance: tokenBalanceBig, 
        required: debtAmount, 
        symbol,
        balanceType: 'token'
      };

      // Cache the balance data (without the hasBalance which depends on debtAmount)
      this.balanceCache.set(cacheKey, {
        walletBalance: tokenBalanceBig,
        symbol,
        balanceType: 'token',
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      logger.error(`Error checking wallet balance for token ${debtAssetAddress}:`, error);
      return { 
        hasBalance: false, 
        error: error.message, 
        symbol: this.getTokenSymbol(debtAssetAddress)
      };
    }
  }

  /**
   * Check wallet balances for all debt assets in the position
   * @param {Array} debtAssets - Array of debt assets from position data
   * @param {string} walletAddress - The wallet address to check
   * @returns {Object} - { allBalancesOk: boolean, balanceDetails: Array }
   */
  async checkAllDebtTokenBalances(debtAssets, walletAddress = null) {
    if (!walletAddress && !this.walletAddress) {
      return { allBalancesOk: false, reason: 'No wallet address provided' };
    }

    const checkAddress = walletAddress || this.walletAddress;
    const balanceDetails = [];
    let allBalancesOk = true;

    for (const debtAsset of debtAssets) {
      try {
        // Get the minimum amount needed (could be the full debt or partial)
        const minAmountNeeded = debtAsset.amount.times('0.1'); // At least 10% of debt to be useful
        
        const balanceCheck = await this.checkWalletTokenBalance(debtAsset.asset, minAmountNeeded);
        balanceDetails.push({
          asset: debtAsset.asset,
          symbol: debtAsset.symbol,
          required: minAmountNeeded.toString(),
          available: balanceCheck.walletBalance?.toString() || '0',
          hasBalance: balanceCheck.hasBalance,
          error: balanceCheck.error
        });

        if (!balanceCheck.hasBalance) {
          allBalancesOk = false;
        }
      } catch (error) {
        logger.error(`Error checking balance for debt asset ${debtAsset.symbol}:`, error);
        balanceDetails.push({
          asset: debtAsset.asset,
          symbol: debtAsset.symbol,
          error: error.message,
          hasBalance: false
        });
        allBalancesOk = false;
      }
    }

    return { allBalancesOk, balanceDetails };
  }

  /**
   * Log current wallet balances for all major tokens on Base
   * Useful for debugging and monitoring what tokens the bot has available
   */
  async logWalletBalances() {
    if (!this.walletAddress) {
      logger.warn('Cannot log wallet balances - wallet address not set');
      return;
    }

    logger.info(`Checking wallet balances for ${this.walletAddress}:`);
    
    // Check ETH balance
    try {
      const ethBalance = await this.provider.getBalance(this.walletAddress);
      const ethBalanceBig = Big(ethBalance.toString()).div('1e18');
      logger.info(`💰 ETH: ${ethBalanceBig.toString()}`);
    } catch (error) {
      logger.error('Error checking ETH balance:', error);
    }

    // Check major token balances
    const majorTokens = [
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      '0x4200000000000000000000000000000000000006', // WETH
      '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', // cbETH
      '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', // USDbC
      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'  // DAI
    ];

    for (const tokenAddress of majorTokens) {
      try {
        const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
        const balance = await tokenContract.balanceOf(this.walletAddress);
        
        let decimals = 18;
        let symbol = this.getTokenSymbol(tokenAddress);
        
        try {
          decimals = await tokenContract.decimals();
          symbol = await tokenContract.symbol();
        } catch (e) {
          // Use defaults
        }

        const balanceBig = Big(balance.toString()).div(`1e${decimals}`);
        
        if (balanceBig.gt('0')) {
          logger.info(`💰 ${symbol}: ${balanceBig.toString()}`);
        } else {
          logger.info(`💰 ${symbol}: 0 (⚠️  No balance - liquidations requiring ${symbol} will fail)`);
        }
      } catch (error) {
        const symbol = this.getTokenSymbol(tokenAddress);
        logger.warn(`Could not check ${symbol} balance:`, error.message);
      }
    }
  }

  clearCache() {
    this.cache.clear();
  }

  setCacheTimeout(timeout) {
    this.cacheTimeout = timeout;
  }

  /**
   * Get PriceOracle health status for monitoring
   */
  async getPriceOracleStatus() {
    try {
      const status = await this.priceOracle.healthCheck();
      const feedStatus = this.priceOracle.getPriceFeedStatus();
      
      return {
        healthy: status.healthy,
        lastETHPrice: status.lastPrice,
        lastUpdate: status.lastUpdate,
        cacheSize: feedStatus.cachedPrices,
        supportedTokens: feedStatus.supportedTokens,
        error: status.error
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  /**
   * Clear price cache (useful for testing or forced refresh)
   */
  clearPriceCache() {
    this.priceOracle.clearCache();
    logger.info('Price oracle cache cleared');
  }
}
