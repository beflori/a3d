#!/usr/bin/env node

/**
 * Simple Address Debug Test
 * 
 * This script tests address extraction from Aave V3 position data
 * to debug the truncation issue.
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { OpportunityValidator } from './src/services/OpportunityValidator.js';
import { AlchemyConfig } from './src/utils/AlchemyConfig.js';
import logger from './logger.js';

dotenv.config();

async function testAddressExtraction() {
  logger.info('🔍 Testing address extraction for the failing borrower');
  
  // Use the same provider configuration as the main bot
  const { provider } = AlchemyConfig.createProviders();
  const validator = new OpportunityValidator(provider);
  
  // The borrower from the error logs
  const borrower = '0xE5CDA4e48Fc198d9eCC9a48f7afDd1F375e0BD35';
  
  try {
    logger.info(`Fetching Aave V3 position for ${borrower}`);
    
    const positionData = await validator.getAaveV3Position(borrower);
    
    if (!positionData) {
      logger.error('No position data returned');
      return;
    }
    
    logger.info('Position data structure:', {
      protocol: positionData.protocol,
      collateralValue: positionData.collateralValue.toString(),
      debtValue: positionData.debtValue.toString(),
      healthFactor: positionData.healthFactor.toString(),
      numCollateralAssets: positionData.collateralAssets?.length || 0,
      numDebtAssets: positionData.debtAssets?.length || 0
    });
    
    // Debug each collateral asset
    if (positionData.collateralAssets?.length > 0) {
      logger.info('🏦 Collateral assets detailed:');
      positionData.collateralAssets.forEach((asset, i) => {
        logger.info(`  [${i}] Full asset object:`, asset);
        logger.info(`  [${i}] Asset address: "${asset.asset}"`);
        logger.info(`  [${i}] Asset address type: ${typeof asset.asset}`);
        logger.info(`  [${i}] Asset address length: ${asset.asset ? asset.asset.length : 0}`);
        logger.info(`  [${i}] Asset address valid: ${ethers.isAddress(asset.asset || '')}`);
        logger.info(`  [${i}] Asset address JSON: ${JSON.stringify(asset.asset)}`);
      });
    }
    
    // Debug each debt asset
    if (positionData.debtAssets?.length > 0) {
      logger.info('💸 Debt assets detailed:');
      positionData.debtAssets.forEach((asset, i) => {
        logger.info(`  [${i}] Full asset object:`, asset);
        logger.info(`  [${i}] Asset address: "${asset.asset}"`);
        logger.info(`  [${i}] Asset address type: ${typeof asset.asset}`);
        logger.info(`  [${i}] Asset address length: ${asset.asset ? asset.asset.length : 0}`);
        logger.info(`  [${i}] Asset address valid: ${ethers.isAddress(asset.asset || '')}`);
        logger.info(`  [${i}] Asset address JSON: ${JSON.stringify(asset.asset)}`);
      });
    }
    
    // Test liquidation parameter calculation
    logger.info('\n🧮 Testing liquidation parameter calculation');
    
    const mockEvent = {
      borrower,
      protocol: 'aave-v3',
      type: 'test'
    };
    
    const liquidationParams = await validator.calculateLiquidationParams(mockEvent, positionData);
    
    logger.info('Liquidation params result:', {
      debtValue: liquidationParams.debtValue.toString(),
      maxCollateralValue: liquidationParams.maxCollateralValue.toString(),
      collateralAsset: liquidationParams.collateralAsset,
      debtAsset: liquidationParams.debtAsset,
      collateralAssetType: typeof liquidationParams.collateralAsset,
      debtAssetType: typeof liquidationParams.debtAsset,
      collateralAssetValid: ethers.isAddress(liquidationParams.collateralAsset || ''),
      debtAssetValid: ethers.isAddress(liquidationParams.debtAsset || '')
    });
    
  } catch (error) {
    logger.error('Error in address extraction test:', error);
  }
}

// Run the test
testAddressExtraction().catch(console.error);
