import dotenv from 'dotenv';
import { LiquidationBot } from './core/LiquidationBot.js';
import { HealthServer } from './services/HealthServer.js';
import logger from '../logger.js';

dotenv.config();

async function main() {
  try {
    logger.info('Starting Base L2 Liquidation Bot...');
    
    // Validate required environment variables
    const requiredEnvVars = [
      'RPC_URL',
      'WSS_URL',
      'PRIVATE_KEY',
      'CHAIN_ID'
    ];
    
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }
    
    const bot = new LiquidationBot();
    await bot.initialize();
    
    // Start health server
    const healthServer = new HealthServer(bot);
    await healthServer.start();
    
    // Graceful shutdown handling
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await healthServer.stop();
      await bot.shutdown();
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection:', { reason, promise });
    });
    
    logger.info('Liquidation bot started successfully');
    
  } catch (error) {
    logger.error('Failed to start liquidation bot:', error);
    process.exit(1);
  }
}

main();
