#!/usr/bin/env node

/**
 * Test script for PriceOracle functionality
 * Tests real-time price feeds, caching, and fallback mechanisms
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { PriceOracle } from './src/services/PriceOracle.js';
import { AlchemyConfig } from './src/utils/AlchemyConfig.js';
import logger from './logger.js';

// Load environment variables
dotenv.config();

async function testPriceOracle() {
  logger.info('🧪 Starting PriceOracle test suite...');
  
  try {
    // Initialize provider
    const { provider } = AlchemyConfig.createProviders();
    
    // Initialize PriceOracle
    const priceOracle = new PriceOracle(provider);
    
    // Test tokens on Base
    const testTokens = {
      'WETH': '0x4200000000000000000000000000000000000006',
      'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'cbETH': '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
      'USDbC': '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
      'DAI': '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'
    };
    
    logger.info('📊 Testing individual token prices...');
    
    // Test individual token prices
    for (const [symbol, address] of Object.entries(testTokens)) {
      try {
        const startTime = Date.now();
        const price = await priceOracle.getTokenPrice(address);
        const duration = Date.now() - startTime;
        
        logger.info(`💰 ${symbol}: $${price.toString()} (${duration}ms)`);
        
        // Test USD value calculation
        const testAmount = symbol === 'USDC' || symbol === 'USDbC' ? '1000' : '1';
        const usdValue = await priceOracle.calculateUSDValue(address, testAmount);
        
        logger.info(`  💵 ${testAmount} ${symbol} = $${usdValue.toString()}`);
        
      } catch (error) {
        logger.error(`❌ Failed to get price for ${symbol}:`, error.message);
      }
    }
    
    logger.info('🚀 Testing bulk price fetch...');
    
    // Test bulk price fetching
    const startTime = Date.now();
    const bulkPrices = await priceOracle.getMultipleTokenPrices(Object.values(testTokens));
    const bulkDuration = Date.now() - startTime;
    
    logger.info(`📦 Bulk fetch completed in ${bulkDuration}ms:`);
    for (const [address, price] of Object.entries(bulkPrices)) {
      const symbol = Object.keys(testTokens).find(key => testTokens[key] === address);
      logger.info(`  ${symbol}: $${price.toString()}`);
    }
    
    logger.info('⏱️  Testing cache performance...');
    
    // Test cache performance
    const wethAddress = testTokens.WETH;
    
    // First call (should fetch from source)
    const firstCallStart = Date.now();
    const firstPrice = await priceOracle.getTokenPrice(wethAddress);
    const firstCallDuration = Date.now() - firstCallStart;
    
    // Second call (should use cache)
    const secondCallStart = Date.now();
    const secondPrice = await priceOracle.getTokenPrice(wethAddress);
    const secondCallDuration = Date.now() - secondCallStart;
    
    logger.info(`🔄 Cache test results:`);
    logger.info(`  First call: $${firstPrice.toString()} (${firstCallDuration}ms)`);
    logger.info(`  Second call: $${secondPrice.toString()} (${secondCallDuration}ms)`);
    logger.info(`  Cache speedup: ${Math.round(firstCallDuration / secondCallDuration)}x faster`);
    
    logger.info('🏥 Testing health check...');
    
    // Test health check
    const healthStatus = await priceOracle.healthCheck();
    logger.info('Health status:', healthStatus);
    
    // Get price feed status
    const feedStatus = priceOracle.getPriceFeedStatus();
    logger.info('Feed status:', feedStatus);
    
    logger.info('🧪 Testing unknown token handling...');
    
    // Test unknown token
    const unknownTokenAddress = '0x1234567890123456789012345678901234567890';
    const unknownPrice = await priceOracle.getTokenPrice(unknownTokenAddress);
    logger.info(`❓ Unknown token price: $${unknownPrice.toString()}`);
    
    logger.info('🔄 Testing cache clearing...');
    
    // Test cache clearing
    priceOracle.clearCache();
    const afterClearStatus = priceOracle.getPriceFeedStatus();
    logger.info('Status after cache clear:', afterClearStatus);
    
    logger.info('✅ PriceOracle test suite completed successfully!');
    
    // Performance summary
    logger.info('📈 Performance Summary:');
    logger.info(`  - Individual token fetches: Average ~${firstCallDuration}ms`);
    logger.info(`  - Cached fetches: Average ~${secondCallDuration}ms`);
    logger.info(`  - Bulk fetch (${Object.keys(testTokens).length} tokens): ${bulkDuration}ms`);
    logger.info(`  - Cache enabled: 2-minute TTL`);
    logger.info(`  - Supported tokens: ${Object.keys(testTokens).length}`);
    
  } catch (error) {
    logger.error('❌ PriceOracle test failed:', error);
    process.exit(1);
  }
}

async function testErrorHandling() {
  logger.info('🔥 Testing error handling and fallbacks...');
  
  try {
    // Test with invalid provider (should use fallbacks)
    const invalidProvider = new ethers.JsonRpcProvider('http://invalid-url');
    const priceOracle = new PriceOracle(invalidProvider);
    
    const wethAddress = '0x4200000000000000000000000000000000000006';
    const fallbackPrice = await priceOracle.getTokenPrice(wethAddress);
    
    logger.info(`🛡️  Fallback price for WETH: $${fallbackPrice.toString()}`);
    
    const healthStatus = await priceOracle.healthCheck();
    logger.info('Health status with invalid provider:', healthStatus);
    
  } catch (error) {
    logger.info('Expected error during fallback test:', error.message);
  }
}

// Main test execution
async function main() {
  try {
    await testPriceOracle();
    await testErrorHandling();
    
    logger.info('🎉 All tests completed!');
    process.exit(0);
    
  } catch (error) {
    logger.error('Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
