import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import logger from '../../logger.js';

export class GasOracle extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = provider;
    this.currentGasPrice = null;
    this.gasHistory = [];
    this.updateInterval = 2000; // Update every 2 seconds
    this.maxGasPrice = ethers.parseUnits(process.env.MAX_GAS_PRICE_GWEI || '50', 'gwei');
    this.isRunning = false;
    this.intervalId = null;
  }

  async start() {
    if (this.isRunning) {
      return;
    }

    logger.info('Starting gas oracle...');
    
    try {
      // Get initial gas price
      await this.updateGasPrice();
      
      // Start periodic updates
      this.intervalId = setInterval(() => {
        this.updateGasPrice().catch(error => {
          logger.error('Gas price update failed:', error);
        });
      }, this.updateInterval);
      
      this.isRunning = true;
      logger.info('Gas oracle started successfully');
      
    } catch (error) {
      logger.error('Failed to start gas oracle:', error);
      throw error;
    }
  }

  async updateGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      
      // For Base L2, we primarily care about gasPrice or maxFeePerGas
      const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
      
      if (!gasPrice) {
        logger.warn('No gas price data available');
        return;
      }
      
      this.currentGasPrice = {
        gasPrice,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        timestamp: Date.now()
      };
      
      // Keep history for trend analysis
      this.gasHistory.push({
        ...this.currentGasPrice
      });
      
      // Keep only last 100 readings
      if (this.gasHistory.length > 100) {
        this.gasHistory.shift();
      }
      
      this.emit('gasPriceUpdate', this.currentGasPrice);
      
      logger.debug('Gas price updated:', {
        gasPrice: ethers.formatUnits(gasPrice, 'gwei') + ' gwei',
        maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') + ' gwei' : null,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') + ' gwei' : null
      });
      
    } catch (error) {
      logger.error('Error updating gas price:', error);
    }
  }

  async getOptimalGasPrice() {
    if (!this.currentGasPrice) {
      await this.updateGasPrice();
    }
    
    // For liquidations, we want to be competitive but not overpay
    const current = this.currentGasPrice;
    
    // On Base L2, speed is critical during congestion
    const isNetworkCongested = this.isNetworkCongested();
    
    if (isNetworkCongested) {
      // Increase gas price for faster inclusion
      const multiplier = 1.2; // 20% increase
      
      if (current.maxFeePerGas) {
        // EIP-1559 transaction
        return {
          maxFeePerGas: this.min(
            current.maxFeePerGas * BigInt(Math.floor(multiplier * 100)) / BigInt(100),
            this.maxGasPrice
          ),
          maxPriorityFeePerGas: current.maxPriorityFeePerGas * BigInt(Math.floor(multiplier * 100)) / BigInt(100)
        };
      } else {
        // Legacy transaction
        return this.min(
          current.gasPrice * BigInt(Math.floor(multiplier * 100)) / BigInt(100),
          this.maxGasPrice
        );
      }
    } else {
      // Network not congested, use current rates
      if (current.maxFeePerGas) {
        return {
          maxFeePerGas: current.maxFeePerGas,
          maxPriorityFeePerGas: current.maxPriorityFeePerGas
        };
      } else {
        return current.gasPrice;
      }
    }
  }

  isNetworkCongested() {
    if (this.gasHistory.length < 10) {
      return false; // Not enough data
    }
    
    // Check if gas prices have increased significantly in recent history
    const recent = this.gasHistory.slice(-10);
    const older = this.gasHistory.slice(-20, -10);
    
    if (older.length === 0) {
      return false;
    }
    
    const recentAvg = recent.reduce((sum, item) => sum + Number(item.gasPrice), 0) / recent.length;
    const olderAvg = older.reduce((sum, item) => sum + Number(item.gasPrice), 0) / older.length;
    
    // Consider congested if gas price increased by more than 50%
    return recentAvg > olderAvg * 1.5;
  }

  min(a, b) {
    return a < b ? a : b;
  }

  getCurrentGasPrice() {
    return this.currentGasPrice;
  }

  getGasHistory() {
    return [...this.gasHistory];
  }

  getGasTrend() {
    if (this.gasHistory.length < 2) {
      return 'stable';
    }
    
    const recent = this.gasHistory.slice(-5);
    const first = Number(recent[0].gasPrice);
    const last = Number(recent[recent.length - 1].gasPrice);
    
    const change = (last - first) / first;
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  async estimateConfirmationTime(gasPrice) {
    // Estimate confirmation time based on gas price
    // This is a rough estimate for Base L2
    
    try {
      const currentOptimal = await this.getOptimalGasPrice();
      const currentGas = currentOptimal.gasPrice || currentOptimal.maxFeePerGas;
      
      const ratio = Number(gasPrice) / Number(currentGas);
      
      if (ratio >= 1.2) return 6; // ~6 seconds for high gas
      if (ratio >= 1.0) return 12; // ~12 seconds for normal gas
      if (ratio >= 0.8) return 24; // ~24 seconds for low gas
      return 60; // ~60 seconds for very low gas
      
    } catch (error) {
      logger.error('Error estimating confirmation time:', error);
      return 30; // Default estimate
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    logger.info('Stopping gas oracle...');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    this.removeAllListeners();
    
    logger.info('Gas oracle stopped');
  }
}
