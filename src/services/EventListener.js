import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import logger from '../../logger.js';

export class EventListener extends EventEmitter {
  constructor(wsProvider) {
    super();
    this.wsProvider = wsProvider;
    this.isListening = false;
    this.contracts = new Map();
    this.filters = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
  }

  async start() {
    try {
      logger.info('Starting event listener...');
      
      // Setup WebSocket connection monitoring
      this.setupConnectionMonitoring();
      
      // Add test events first to verify connection
      //await this.addTestEvents();
      
      // Add lending protocol contracts to monitor
      await this.addLendingProtocols();
      
      this.isListening = true;
      logger.info('Event listener started successfully');
      
    } catch (error) {
      logger.error('Failed to start event listener:', error);
      throw error;
    }
  }

  setupConnectionMonitoring() {
    this.wsProvider.on('error', (error) => {
      logger.error('WebSocket error:', error);
      this.emit('error', error);
      this.handleReconnection();
    });

    // Note: 'close' event is not available on ethers WebSocketProvider
    // We'll detect disconnections through failed getBlockNumber calls
    
    // Heartbeat to detect stale connections (reduced from 30 seconds to 5 minutes)
    setInterval(() => {
      this.checkConnection();
    }, 300000);
  }

  async checkConnection() {
    try {
      await this.wsProvider.getBlockNumber();
    } catch (error) {
      logger.warn('Connection check failed, attempting reconnection');
      this.handleReconnection();
    }
  }

  async handleReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    logger.info(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    setTimeout(async () => {
      try {
        await this.wsProvider._start();
        await this.resubscribeToEvents();
        this.reconnectAttempts = 0;
        logger.info('Reconnection successful');
      } catch (error) {
        logger.error('Reconnection failed:', error);
        this.handleReconnection();
      }
    }, this.reconnectDelay);
  }

  async addTestEvents() {
    logger.info('🧪 Adding test events to verify WebSocket connection...');
    
    try {
      // 1. Listen for new blocks to verify basic WebSocket connectivity
      this.wsProvider.on('block', (blockNumber) => {
        logger.info(`📦 New block detected: ${blockNumber}`);
      });

      // 2. Listen for general Transfer events on USDC (very active token)
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
      const transferABI = [
        "event Transfer(address indexed from, address indexed to, uint256 value)"
      ];
      
      const usdcContract = new ethers.Contract(usdcAddress, transferABI, this.wsProvider);
      this.contracts.set(`test-usdc`, usdcContract);
      
      // Listen to USDC transfers (should see activity immediately)
      let transferCount = 0;
      usdcContract.on('Transfer', (from, to, value, event) => {
        transferCount++;
        if (transferCount <= 5) { // Only log first 5 to avoid spam
          logger.info(`💸 USDC Transfer #${transferCount}: ${ethers.formatUnits(value, 6)} USDC`, {
            from: from.slice(0, 8) + '...',
            to: to.slice(0, 8) + '...',
            block: event.blockNumber
          });
        }
      });

      // 3. Listen for Aave V3 activity (broader events)
      const aavePoolAddress = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
      const aaveTestABI = [
        "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
        "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
        "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
        "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
        "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"
      ];
      
      const aaveTestContract = new ethers.Contract(aavePoolAddress, aaveTestABI, this.wsProvider);
      this.contracts.set(`test-aave-activity`, aaveTestContract);
      
      // Listen for any Aave activity
      aaveTestContract.on('Supply', (reserve, user, onBehalfOf, amount, referralCode, event) => {
        logger.info(`🏦 Aave Supply detected:`, {
          user: user.slice(0, 8) + '...',
          amount: ethers.formatEther(amount),
          block: event.blockNumber
        });
      });
      
      aaveTestContract.on('Borrow', (reserve, user, onBehalfOf, amount, interestRateMode, borrowRate, referralCode, event) => {
        logger.info(`💰 Aave Borrow detected:`, {
          user: user.slice(0, 8) + '...',
          amount: ethers.formatEther(amount),
          block: event.blockNumber
        });
      });

      // Monitor for actual liquidations
      aaveTestContract.on('LiquidationCall', (collateralAsset, debtAsset, user, debtToCover, liquidatedCollateralAmount, liquidator, receiveAToken, event) => {
        logger.warn(`🚨 REAL LIQUIDATION DETECTED! 🚨`, {
          user: user.slice(0, 8) + '...',
          liquidator: liquidator.slice(0, 8) + '...',
          debtToCover: ethers.formatEther(debtToCover),
          block: event.blockNumber,
          txHash: event.transactionHash
        });
      });

      logger.info('✅ Test events configured - you should see activity within 30 seconds!');
      logger.info('📊 Monitoring: New blocks, USDC transfers, Aave activity, and liquidations');
      
    } catch (error) {
      logger.error('Failed to setup test events:', error);
    }
  }

  async addLendingProtocols() {
    // Add Compound V3-like protocol
    await this.addCompoundV3Protocol();
    
    // Add Aave V3-like protocol  
    await this.addAaveV3Protocol();
    
    // Add custom liquidation opportunities
    await this.addCustomProtocols();
  }

  async addCompoundV3Protocol() {
    // Example Compound V3 liquidation events
    const compoundV3ABI = [
      "event AbsorbDebt(address indexed absorber, address indexed borrower, uint256 basePaidOut, uint256 usdValue)",
      "event AbsorbCollateral(address indexed absorber, address indexed borrower, address indexed asset, uint256 collateralAbsorbed, uint256 usdValue)"
    ];

    // Compound V3 contract addresses on Base mainnet
    const contractAddresses = [
      "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", // Compound V3 USDC market
      "0x46e6b214b524310239732D51387075E0e70970bf", // Compound V3 ETH market
    ];

    for (const address of contractAddresses) {
      try {
        const contract = new ethers.Contract(address, compoundV3ABI, this.wsProvider);
        this.contracts.set(`compound-${address}`, contract);
        
        // Listen for liquidation opportunities
        contract.on('AbsorbDebt', (absorber, borrower, basePaidOut, usdValue, event) => {
          this.handleLiquidationEvent('compound-v3', {
            protocol: 'compound-v3',
            type: 'absorb-debt',
            borrower,
            absorber,
            amount: basePaidOut,
            usdValue,
            txHash: event.transactionHash,
            blockNumber: event.blockNumber
          });
        });

        logger.info(`Added Compound V3 contract: ${address}`);
      } catch (error) {
        logger.error(`Failed to add Compound V3 contract ${address}:`, error);
      }
    }
  }

  async addAaveV3Protocol() {
    // Example Aave V3 liquidation events
    const aaveV3ABI = [
      "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"
    ];

    // Aave V3 contract addresses on Base mainnet
    const contractAddresses = [
      "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Aave V3 Pool on Base
    ];

    for (const address of contractAddresses) {
      try {
        const contract = new ethers.Contract(address, aaveV3ABI, this.wsProvider);
        this.contracts.set(`aave-${address}`, contract);
        
        contract.on('LiquidationCall', (collateralAsset, debtAsset, user, debtToCover, liquidatedCollateralAmount, liquidator, receiveAToken, event) => {
          this.handleLiquidationEvent('aave-v3', {
            protocol: 'aave-v3',
            type: 'liquidation-call',
            borrower: user,
            collateralAsset,
            debtAsset,
            debtToCover,
            liquidatedCollateralAmount,
            liquidator,
            txHash: event.transactionHash,
            blockNumber: event.blockNumber
          });
        });

        logger.info(`Added Aave V3 contract: ${address}`);
      } catch (error) {
        logger.error(`Failed to add Aave V3 contract ${address}:`, error);
      }
    }
  }

  async addCustomProtocols() {
    // Add Moonwell (Base's native lending protocol)
    await this.addMoonwellProtocol();
    
    logger.info('Custom protocol monitoring configured');
  }

  async addMoonwellProtocol() {
    // Moonwell liquidation events (Compound V2-style)
    const moonwellABI = [
      "event LiquidateBorrow(address liquidator, address borrower, uint256 repayAmount, address cTokenCollateral, uint256 seizeTokens)"
    ];

    // Moonwell market addresses on Base
    const contractAddresses = [
      "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22", // Moonwell USDC
      "0x628ff693426583D9a7FB391E54366292F509D457", // Moonwell WETH  
      "0x0dc808adcE2099A9F62AA87D9670745AbA741746", // Moonwell cbETH
      "0xF877ACaAE7b5459b9B14dCd8c61cBb2A4F7E1c79", // Moonwell EURC
    ];

    for (const address of contractAddresses) {
      try {
        const contract = new ethers.Contract(address, moonwellABI, this.wsProvider);
        this.contracts.set(`moonwell-${address}`, contract);
        
        contract.on('LiquidateBorrow', (liquidator, borrower, repayAmount, cTokenCollateral, seizeTokens, event) => {
          this.handleLiquidationEvent('moonwell', {
            protocol: 'moonwell',
            type: 'liquidate-borrow',
            borrower,
            liquidator,
            repayAmount,
            collateralAsset: cTokenCollateral,
            seizeTokens,
            txHash: event.transactionHash,
            blockNumber: event.blockNumber
          });
        });

        logger.info(`Added Moonwell contract: ${address}`);
      } catch (error) {
        logger.error(`Failed to add Moonwell contract ${address}:`, error);
      }
    }
  }

  handleLiquidationEvent(protocol, eventData) {
    const startTime = Date.now();
    
    logger.info('Liquidation event detected:', {
      protocol,
      borrower: eventData.borrower,
      type: eventData.type,
      blockNumber: eventData.blockNumber
    });

    // Fast path: emit opportunity immediately for speed
    this.emit('liquidationOpportunity', {
      ...eventData,
      detectedAt: startTime,
      protocol
    });
  }

  async resubscribeToEvents() {
    // Resubscribe to all events after reconnection
    for (const [name, contract] of this.contracts) {
      try {
        // Remove all listeners and re-add them
        contract.removeAllListeners();
        
        if (name.startsWith('compound')) {
          // Re-add Compound listeners
          // ... (implementation would mirror addCompoundV3Protocol)
        } else if (name.startsWith('aave')) {
          // Re-add Aave listeners
          // ... (implementation would mirror addAaveV3Protocol)
        }
        
      } catch (error) {
        logger.error(`Failed to resubscribe to ${name}:`, error);
      }
    }
  }

  async addContract(name, address, abi, eventHandlers) {
    try {
      const contract = new ethers.Contract(address, abi, this.wsProvider);
      this.contracts.set(name, contract);
      
      // Add event listeners
      for (const [eventName, handler] of Object.entries(eventHandlers)) {
        contract.on(eventName, handler);
      }
      
      logger.info(`Added contract ${name} at ${address}`);
    } catch (error) {
      logger.error(`Failed to add contract ${name}:`, error);
      throw error;
    }
  }

  async stop() {
    logger.info('Stopping event listener...');
    
    this.isListening = false;
    
    // Remove all contract listeners
    for (const [name, contract] of this.contracts) {
      try {
        contract.removeAllListeners();
        logger.info(`Removed listeners for ${name}`);
      } catch (error) {
        logger.error(`Error removing listeners for ${name}:`, error);
      }
    }
    
    this.contracts.clear();
    this.filters.clear();
    
    logger.info('Event listener stopped');
  }
}
