import express from 'express';
import logger from '../../logger.js';

export class HealthServer {
  constructor(bot) {
    this.bot = bot;
    this.app = express();
    this.server = null;
    this.port = process.env.HEALTH_PORT || 3000;
    
    this.setupRoutes();
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const status = await this.bot.getStatus();
        const health = {
          status: status.isRunning ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: status.uptime,
          activeLiquidations: status.activeLiquidations,
          walletAddress: status.walletAddress,
          priceOracle: status.priceOracle
        };
        
        if (status.isRunning && status.priceOracle?.healthy) {
          res.status(200).json(health);
        } else {
          res.status(503).json(health);
        }
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      try {
        const metrics = this.bot.metricsCollector?.getMetricsSummary() || {};
        res.json({
          ...metrics,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Status endpoint
    this.app.get('/status', (req, res) => {
      try {
        const status = this.bot.getStatus();
        res.json({
          ...status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // PriceOracle health endpoint
    this.app.get('/price-oracle', async (req, res) => {
      try {
        if (!this.bot.priceOracle) {
          return res.status(503).json({
            status: 'unavailable',
            error: 'PriceOracle not initialized',
            timestamp: new Date().toISOString()
          });
        }

        const health = await this.bot.priceOracle.healthCheck();
        const prices = await this.bot.priceOracle.getAllCachedPrices();
        
        res.status(health.healthy ? 200 : 503).json({
          ...health,
          cachedPrices: prices,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Ready endpoint (for Kubernetes readiness probes)
    this.app.get('/ready', (req, res) => {
      const status = this.bot.getStatus();
      if (status.isRunning) {
        res.status(200).send('Ready');
      } else {
        res.status(503).send('Not Ready');
      }
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          logger.info(`Health server listening on port ${this.port}`);
          resolve();
        }
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Health server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
