#!/usr/bin/env node

// Simple test to check imports
try {
  console.log('Testing imports...');
  
  // Test basic import
  const { ethers } = require('ethers');
  console.log('✅ ethers imported');
  
  // Test dynamic import
  import('./src/services/PriceOracle.js').then((module) => {
    console.log('✅ PriceOracle imported');
    console.log('PriceOracle class:', typeof module.PriceOracle);
  }).catch((error) => {
    console.error('❌ PriceOracle import failed:', error.message);
  });
  
} catch (error) {
  console.error('❌ Basic import failed:', error.message);
}
