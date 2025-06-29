#!/usr/bin/env node

// Test script to verify cToken to underlying token mapping
import { OpportunityValidator } from './src/services/OpportunityValidator.js';
import logger from './logger.js';

async function testCTokenMapping() {
  console.log('Testing cToken to underlying token mapping...\n');
  
  // Mock provider for testing
  const mockProvider = {
    getBalance: () => Promise.resolve(BigInt(0)),
    // Other methods not needed for this test
  };
  
  const validator = new OpportunityValidator(mockProvider);
  
  // Test cases
  const testCases = [
    {
      name: 'mUSDC -> USDC',
      cToken: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
      expectedUnderlying: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    },
    {
      name: 'mWETH -> WETH',
      cToken: '0x628ff693426583D9a7FB391E54366292F509D457',
      expectedUnderlying: '0x4200000000000000000000000000000000000006'
    },
    {
      name: 'mcbETH -> cbETH',
      cToken: '0x0dc808adcE2099A9F62AA87D9670745AbA741746',
      expectedUnderlying: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22'
    },
    {
      name: 'USDC (non-cToken) -> USDC',
      cToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      expectedUnderlying: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    const actualUnderlying = validator.getUnderlyingTokenAddress(testCase.cToken);
    const isCToken = validator.isCToken(testCase.cToken);
    const success = actualUnderlying.toLowerCase() === testCase.expectedUnderlying.toLowerCase();
    
    console.log(`\n${testCase.name}:`);
    console.log(`  Input (cToken): ${testCase.cToken}`);
    console.log(`  Expected: ${testCase.expectedUnderlying}`);
    console.log(`  Actual: ${actualUnderlying}`);
    console.log(`  Is cToken: ${isCToken}`);
    console.log(`  Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
    
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log(`\n📊 Test Results:`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log(`\n🎉 All tests passed! The cToken mapping is working correctly.`);
  } else {
    console.log(`\n❌ Some tests failed. Please check the mapping.`);
  }
}

// Run the test
testCTokenMapping().catch(console.error);
