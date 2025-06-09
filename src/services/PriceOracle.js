import Big from 'big.js';
import { ethers } from 'ethers';
import logger from '../../logger.js';

/**
 * PriceOracle service to fetch real-time token prices
 * Supports multiple data sources with fallbacks and caching
 */
export class PriceOracle {
  constructor(provider) {
    this.provider = provider;
    this.priceCache = new Map();
    this.cacheTimeout = 120000; // 2 minutes cache
    this.maxRetries = 3;
    
    // Token address to symbol mapping for Base mainnet
    this.tokenMappings = {
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': { symbol: 'USDC', decimals: 6, isStablecoin: true },
      '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18, coingeckoId: 'ethereum' },
      '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22': { symbol: 'cbETH', decimals: 18, coingeckoId: 'coinbase-wrapped-staked-eth' },
      '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA': { symbol: 'USDbC', decimals: 6, isStablecoin: true },
      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb': { symbol: 'DAI', decimals: 18, isStablecoin: true },
      '0xB79DD08EA68A908A97220C76d19A6aA9cBDD4376': { symbol: 'USD+', decimals: 6, isStablecoin: true },
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631': { symbol: 'AERO', decimals: 18, coingeckoId: 'aerodrome-finance' },
    };

    // Chainlink price feed addresses on Base (when available)
    this.chainlinkFeeds = {
      'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
      'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
      // Add more as they become available on Base
    };

    // DEX pool addresses for price discovery (Uniswap V3 on Base)
    this.uniswapV3Pools = {
      'WETH/USDC': '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18', // Example - verify actual address
      // Add more pool addresses
    };

    this.lastPriceUpdate = new Map();
  }

  /**
   * Get the current USD price for a token
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<Big>} Price in USD
   */
  async getTokenPrice(tokenAddress) {
    const normalizedAddress = tokenAddress.toLowerCase();
    const tokenInfo = this.tokenMappings[normalizedAddress];
    
    if (!tokenInfo) {
      logger.warn(`Unknown token address for pricing: ${tokenAddress}`);
      return Big('1'); // Default to $1 for unknown tokens
    }

    // Return $1 for stablecoins
    if (tokenInfo.isStablecoin) {
      return Big('1');
    }

    // Check cache first
    const cached = this.getCachedPrice(normalizedAddress);
    if (cached) {
      return cached;
    }

    try {
      // Try multiple data sources in order of preference
      let price = null;

      // 1. Try Chainlink first (most reliable)
      price = await this.getChainlinkPrice(tokenInfo.symbol);
      if (price) {
        this.setCachedPrice(normalizedAddress, price);
        return price;
      }

      // 2. Try CoinGecko API
      price = await this.getCoinGeckoPrice(tokenInfo.coingeckoId);
      if (price) {
        this.setCachedPrice(normalizedAddress, price);
        return price;
      }

      // 3. Try DEX price discovery (Uniswap V3)
      price = await this.getDexPrice(normalizedAddress, tokenInfo);
      if (price) {
        this.setCachedPrice(normalizedAddress, price);
        return price;
      }

      // 4. Fallback to hardcoded reasonable estimates
      const fallbackPrice = this.getFallbackPrice(tokenInfo.symbol);
      logger.warn(`Using fallback price for ${tokenInfo.symbol}: $${fallbackPrice.toString()}`);
      return fallbackPrice;

    } catch (error) {
      logger.error(`Error fetching price for ${tokenInfo.symbol}:`, error.message);
      return this.getFallbackPrice(tokenInfo.symbol);
    }
  }

  /**
   * Get price from Chainlink oracles
   */
  async getChainlinkPrice(symbol) {
    try {
      const feedAddress = this.chainlinkFeeds[`${symbol}/USD`];
      if (!feedAddress) {
        return null;
      }

      const aggregatorV3Interface = [
        'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
      ];

      const priceFeed = new ethers.Contract(feedAddress, aggregatorV3Interface, this.provider);
      const roundData = await priceFeed.latestRoundData();
      
      // Chainlink prices are typically 8 decimals
      const price = Big(roundData.answer.toString()).div('1e8');
      
      logger.info(`Chainlink price for ${symbol}: $${price.toString()}`);
      return price;

    } catch (error) {
      logger.warn(`Chainlink price fetch failed for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get price from CoinGecko API
   */
  async getCoinGeckoPrice(coingeckoId) {
    if (!coingeckoId) {
      return null;
    }

    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_24hr_change=true`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Liquidation-Bot/1.0'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      const priceData = data[coingeckoId];
      
      if (!priceData || !priceData.usd) {
        return null;
      }

      const price = Big(priceData.usd.toString());
      const change24h = priceData.usd_24h_change || 0;
      
      logger.info(`CoinGecko price for ${coingeckoId}: $${price.toString()} (24h: ${change24h.toFixed(2)}%)`);
      return price;

    } catch (error) {
      logger.warn(`CoinGecko price fetch failed for ${coingeckoId}:`, error.message);
      return null;
    }
  }

  /**
   * Get price from DEX pools (Uniswap V3)
   */
  async getDexPrice(tokenAddress, tokenInfo) {
    try {
      // For WETH, get WETH/USDC pool price
      if (tokenInfo.symbol === 'WETH' || tokenInfo.symbol === 'cbETH') {
        return await this.getUniswapV3Price(tokenAddress, 'USDC');
      }

      return null;

    } catch (error) {
      logger.warn(`DEX price fetch failed for ${tokenInfo.symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get price from Uniswap V3 pool
   */
  async getUniswapV3Price(token0Address, quoteCurrency) {
    try {
      const poolAddress = this.uniswapV3Pools[`WETH/${quoteCurrency}`];
      if (!poolAddress) {
        return null;
      }

      const poolABI = [
        'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
      ];

      const poolContract = new ethers.Contract(poolAddress, poolABI, this.provider);
      const slot0 = await poolContract.slot0();
      
      // Calculate price from sqrtPriceX96
      const sqrtPriceX96 = Big(slot0.sqrtPriceX96.toString());
      const Q96 = Big('2').pow(96);
      const price = sqrtPriceX96.div(Q96).pow(2);
      
      // Adjust for token decimals (WETH has 18, USDC has 6)
      const adjustedPrice = price.times(Big('10').pow(18 - 6));
      
      logger.info(`Uniswap V3 WETH/USDC price: $${adjustedPrice.toString()}`);
      return adjustedPrice;

    } catch (error) {
      logger.warn(`Uniswap V3 price fetch failed:`, error.message);
      return null;
    }
  }

  /**
   * Get fallback prices for known tokens
   */
  getFallbackPrice(symbol) {
    const fallbackPrices = {
      'WETH': Big('2500'), // Conservative ETH estimate
      'cbETH': Big('2450'), // Slightly less than ETH
      'AERO': Big('1.5'),   // Example price
      'USDC': Big('1'),
      'USDbC': Big('1'),
      'DAI': Big('1'),
      'USD+': Big('1')
    };

    return fallbackPrices[symbol] || Big('1');
  }

  /**
   * Get all cached prices for debugging and health monitoring
   */
  getAllCachedPrices() {
    const result = {};
    const now = Date.now();
    
    for (const [address, data] of this.priceCache.entries()) {
      if (now - data.timestamp <= this.cacheTimeout) {
        const tokenInfo = this.tokenMappings[address.toLowerCase()];
        const symbol = tokenInfo ? tokenInfo.symbol : address;
        result[symbol] = {
          price: data.price.toString(),
          address: address,
          lastUpdate: data.timestamp,
          age: now - data.timestamp
        };
      }
    }
    
    return result;
  }

  /**
   * Cache management
   */
  getCachedPrice(tokenAddress) {
    const cached = this.priceCache.get(tokenAddress);
    if (!cached) {
      return null;
    }

    const { price, timestamp } = cached;
    if (Date.now() - timestamp > this.cacheTimeout) {
      this.priceCache.delete(tokenAddress);
      return null;
    }

    return price;
  }

  setCachedPrice(tokenAddress, price) {
    this.priceCache.set(tokenAddress, {
      price,
      timestamp: Date.now()
    });

    this.lastPriceUpdate.set(tokenAddress, Date.now());
  }

  /**
   * Get multiple token prices efficiently
   */
  async getMultipleTokenPrices(tokenAddresses) {
    const prices = {};
    const promises = tokenAddresses.map(async (address) => {
      try {
        const price = await this.getTokenPrice(address);
        prices[address] = price;
      } catch (error) {
        logger.error(`Failed to get price for ${address}:`, error.message);
        prices[address] = Big('1'); // Fallback
      }
    });

    await Promise.all(promises);
    return prices;
  }

  /**
   * Calculate USD value for a token amount
   */
  async calculateUSDValue(tokenAddress, tokenAmount) {
    const price = await this.getTokenPrice(tokenAddress);
    return price.times(tokenAmount);
  }

  /**
   * Get price feed status for monitoring
   */
  getPriceFeedStatus() {
    const status = {
      cachedPrices: this.priceCache.size,
      lastUpdates: Object.fromEntries(this.lastPriceUpdate),
      supportedTokens: Object.keys(this.tokenMappings).length
    };

    return status;
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache() {
    this.priceCache.clear();
    this.lastPriceUpdate.clear();
    logger.info('Price cache cleared');
  }

  /**
   * Get human-readable token info
   */
  getTokenInfo(tokenAddress) {
    return this.tokenMappings[tokenAddress.toLowerCase()] || {
      symbol: 'UNKNOWN',
      decimals: 18,
      isStablecoin: false
    };
  }

  /**
   * Health check method
   */
  async healthCheck() {
    try {
      // Test with a known token (WETH)
      const wethAddress = '0x4200000000000000000000000000000000000006';
      const price = await this.getTokenPrice(wethAddress);
      
      const isHealthy = price && price.gt('0') && price.lt('10000'); // Reasonable ETH price range
      
      return {
        healthy: isHealthy,
        lastPrice: price?.toString(),
        cacheSize: this.priceCache.size,
        lastUpdate: this.lastPriceUpdate.get(wethAddress)
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}
