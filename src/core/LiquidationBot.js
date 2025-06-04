import { ethers } from 'ethers';
import { EventListener } from '../services/EventListener.js';
import { OpportunityValidator } from '../services/OpportunityValidator.js';
import { TransactionExecutor } from '../services/TransactionExecutor.js';
import { GasOracle } from '../services/GasOracle.js';
import { MetricsCollector } from '../services/MetricsCollector.js';
import { AlchemyConfig } from '../utils/AlchemyConfig.js';
import logger from '../../logger.js';

export class LiquidationBot {
  constructor() {
    this.isRunning = false;
    this.provider = null;
    this.wallet = null;
    this.eventListener = null;
    this.opportunityValidator = null;
    this.transactionExecutor = null;
    this.gasOracle = null;
    this.metricsCollector = null;
    this.activeLiquidations = new Map();
  }

  async initialize() {
    try {
      logger.info('Initializing liquidation bot components...');
      
      // Initialize providers using Alchemy configuration
      const { provider, wsProvider } = AlchemyConfig.createProviders();
      this.provider = provider;
      this.wsProvider = wsProvider;
      
      // Log Alchemy configuration
      const { rpcUrl, wssUrl } = AlchemyConfig.getEndpoints();
      logger.info('Using Alchemy endpoints:', {
        rpc: rpcUrl.replace(/\/[^\/]+$/, '/***'), // Hide API key in logs
        wss: wssUrl.replace(/\/[^\/]+$/, '/***')
      });
      
      // Initialize wallet
      this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
      logger.info(`Bot wallet address: ${this.wallet.address}`);
      
      // Check wallet balance
      const balance = await this.provider.getBalance(this.wallet.address);
      logger.info(`Wallet balance: ${ethers.formatEther(balance)} ETH`);
      
      if (balance < ethers.parseEther('0.01')) {
        logger.warn('Low wallet balance detected');
      }
      
      // Initialize services
      this.gasOracle = new GasOracle(this.provider);
      this.opportunityValidator = new OpportunityValidator(this.provider);
      this.transactionExecutor = new TransactionExecutor(this.wallet, this.gasOracle);
      this.eventListener = new EventListener(this.wsProvider);
      this.metricsCollector = new MetricsCollector();
      
      // Setup event handlers
      this.setupEventHandlers();
      
      // Start services
      await this.gasOracle.start();
      await this.eventListener.start();
      await this.metricsCollector.start();
      
      this.isRunning = true;
      logger.info('Liquidation bot initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize liquidation bot:', error);
      throw error;
    }
  }

  setupEventHandlers() {
    // Listen for liquidation opportunities
    this.eventListener.on('liquidationOpportunity', async (event) => {
      const startTime = Date.now();
      
      try {
        logger.opportunity({
          event: 'detected',
          borrower: event.borrower,
          collateralAsset: event.collateralAsset,
          debtAsset: event.debtAsset,
          timestamp: startTime
        });
        
        // Check if we're already processing this borrower
        if (this.activeLiquidations.has(event.borrower)) {
          logger.info(`Already processing liquidation for ${event.borrower}`);
          return;
        }
        
        // Mark as active
        this.activeLiquidations.set(event.borrower, startTime);
        
        // Validate opportunity
        const validation = await this.opportunityValidator.validate(event);
        
        if (!validation.isValid) {
          logger.info(`Liquidation opportunity invalid: ${validation.reason}`);
          this.activeLiquidations.delete(event.borrower);
          return;
        }
        
        logger.opportunity({
          event: 'validated',
          borrower: event.borrower,
          expectedProfit: validation.expectedProfit,
          healthFactor: validation.healthFactor,
          validationTime: Date.now() - startTime
        });
        
        // Execute liquidation
        await this.executeLiquidation(event, validation);
        
      } catch (error) {
        logger.error('Error processing liquidation opportunity:', {
          error: error.message,
          stack: error.stack,
          borrower: event.borrower
        });
        
        this.metricsCollector.recordError('liquidation_processing', error);
      } finally {
        this.activeLiquidations.delete(event.borrower);
        logger.performance('Liquidation processing', startTime);
      }
    });

    // Listen for gas price updates
    this.gasOracle.on('gasPriceUpdate', (gasPrice) => {
      this.metricsCollector.recordGasPrice(gasPrice);
    });

    // Handle WebSocket errors
    this.eventListener.on('error', (error) => {
      logger.error('EventListener error:', error);
      this.metricsCollector.recordError('event_listener', error);
    });
  }

  async executeLiquidation(event, validation) {
    const startTime = Date.now();
    
    try {
      logger.liquidation({
        event: 'starting',
        borrower: event.borrower,
        expectedProfit: validation.expectedProfit
      });
      
      // Get current gas price
      const gasPrice = await this.gasOracle.getOptimalGasPrice();
      
      // Execute the liquidation transaction
      const txHash = await this.transactionExecutor.executeLiquidation(
        event,
        validation,
        gasPrice
      );
      
      const executionTime = Date.now() - startTime;
      
      logger.liquidation({
        event: 'executed',
        borrower: event.borrower,
        txHash,
        executionTime,
        gasPrice: gasPrice.toString()
      });
      
      this.metricsCollector.recordLiquidation({
        success: true,
        executionTime,
        profit: validation.expectedProfit,
        gasPrice
      });
      
      // Monitor transaction confirmation
      this.monitorTransaction(txHash, event.borrower);
      
    } catch (error) {
      logger.error('Failed to execute liquidation:', {
        error: error.message,
        borrower: event.borrower,
        executionTime: Date.now() - startTime
      });
      
      this.metricsCollector.recordLiquidation({
        success: false,
        executionTime: Date.now() - startTime,
        error: error.message
      });
      
      throw error;
    }
  }

  async monitorTransaction(txHash, borrower) {
    try {
      const receipt = await this.provider.waitForTransaction(txHash, 1, 30000);
      
      if (receipt.status === 1) {
        logger.transaction({
          event: 'confirmed',
          txHash,
          borrower,
          gasUsed: receipt.gasUsed.toString(),
          blockNumber: receipt.blockNumber
        });
      } else {
        logger.error('Transaction failed:', { txHash, borrower });
      }
      
    } catch (error) {
      logger.error('Transaction monitoring failed:', {
        txHash,
        borrower,
        error: error.message
      });
    }
  }

  async shutdown() {
    logger.info('Shutting down liquidation bot...');
    
    this.isRunning = false;
    
    // Stop all services
    if (this.eventListener) {
      await this.eventListener.stop();
    }
    
    if (this.gasOracle) {
      await this.gasOracle.stop();
    }
    
    if (this.metricsCollector) {
      await this.metricsCollector.stop();
    }
    
    // Close WebSocket connections
    if (this.wsProvider) {
      await this.wsProvider.destroy();
    }
    
    logger.info('Liquidation bot shut down complete');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      activeLiquidations: this.activeLiquidations.size,
      walletAddress: this.wallet?.address,
      uptime: this.metricsCollector?.getUptime()
    };
  }
}
