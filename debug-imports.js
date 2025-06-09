#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

console.log('🧪 Starting basic test...');
console.log('Environment check:');
console.log('- ALCHEMY_API_KEY:', process.env.ALCHEMY_API_KEY ? 'SET' : 'NOT SET');
console.log('- CHAIN_ID:', process.env.CHAIN_ID || 'NOT SET');

try {
  const { ethers } = await import('ethers');
  console.log('✅ ethers imported successfully');
  
  const { PriceOracle } = await import('./src/services/PriceOracle.js');
  console.log('✅ PriceOracle imported successfully');
  
  const { AlchemyConfig } = await import('./src/utils/AlchemyConfig.js');
  console.log('✅ AlchemyConfig imported successfully');
  
  const { provider } = AlchemyConfig.createProviders();
  console.log('✅ Provider created');
  
  const priceOracle = new PriceOracle(provider);
  console.log('✅ PriceOracle instantiated');
  
  console.log('🎉 All imports successful!');
  
} catch (error) {
  console.error('❌ Test failed:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
}
