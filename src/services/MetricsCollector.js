import logger from '../../logger.js';

export class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      liquidationsAttempted: 0,
      liquidationsSuccessful: 0,
      liquidationsFailed: 0,
      totalProfit: 0,
      totalGasCost: 0,
      averageExecutionTime: 0,
      errors: new Map(),
      gasPriceHistory: [],
      performanceMetrics: {
        fastExecutions: 0, // < 200ms
        slowExecutions: 0, // > 200ms
        timeouts: 0
      }
    };
    this.isRunning = false;
    this.reportInterval = parseInt(process.env.METRICS_INTERVAL || '60000'); // 1 minute
    this.intervalId = null;
  }

  async start() {
    if (this.isRunning) {
      return;
    }

    logger.info('Starting metrics collector...');
    
    // Start periodic reporting
    this.intervalId = setInterval(() => {
      this.reportMetrics();
    }, this.reportInterval);
    
    this.isRunning = true;
    logger.info('Metrics collector started');
  }

  recordLiquidation(data) {
    this.metrics.liquidationsAttempted++;
    
    if (data.success) {
      this.metrics.liquidationsSuccessful++;
      
      if (data.profit) {
        this.metrics.totalProfit += Number(data.profit);
      }
      
      if (data.gasPrice) {
        this.metrics.totalGasCost += Number(data.gasPrice) * 300000; // Estimate gas used
      }
    } else {
      this.metrics.liquidationsFailed++;
    }
    
    // Record execution time performance
    if (data.executionTime) {
      this.updateAverageExecutionTime(data.executionTime);
      
      if (data.executionTime < 200) {
        this.metrics.performanceMetrics.fastExecutions++;
      } else {
        this.metrics.performanceMetrics.slowExecutions++;
      }
    }
    
    logger.info('Liquidation metrics updated:', {
      attempted: this.metrics.liquidationsAttempted,
      successful: this.metrics.liquidationsSuccessful,
      successRate: this.getSuccessRate()
    });
  }

  recordError(type, error) {
    const errorKey = `${type}:${error.message}`;
    const current = this.metrics.errors.get(errorKey) || 0;
    this.metrics.errors.set(errorKey, current + 1);
    
    logger.error('Error recorded in metrics:', {
      type,
      error: error.message,
      count: current + 1
    });
  }

  recordGasPrice(gasPriceData) {
    this.metrics.gasPriceHistory.push({
      gasPrice: gasPriceData.gasPrice?.toString(),
      maxFeePerGas: gasPriceData.maxFeePerGas?.toString(),
      timestamp: Date.now()
    });
    
    // Keep only last 1000 entries
    if (this.metrics.gasPriceHistory.length > 1000) {
      this.metrics.gasPriceHistory.shift();
    }
  }

  recordTimeout() {
    this.metrics.performanceMetrics.timeouts++;
  }

  updateAverageExecutionTime(newTime) {
    const total = this.metrics.liquidationsAttempted;
    const current = this.metrics.averageExecutionTime;
    
    this.metrics.averageExecutionTime = (current * (total - 1) + newTime) / total;
  }

  getSuccessRate() {
    if (this.metrics.liquidationsAttempted === 0) {
      return 0;
    }
    
    return (this.metrics.liquidationsSuccessful / this.metrics.liquidationsAttempted) * 100;
  }

  getUptime() {
    return Date.now() - this.startTime;
  }

  reportMetrics() {
    const uptime = this.getUptime();
    const successRate = this.getSuccessRate();
    
    const report = {
      uptime: Math.floor(uptime / 1000), // seconds
      liquidations: {
        attempted: this.metrics.liquidationsAttempted,
        successful: this.metrics.liquidationsSuccessful,
        failed: this.metrics.liquidationsFailed,
        successRate: successRate.toFixed(2) + '%'
      },
      performance: {
        averageExecutionTime: Math.round(this.metrics.averageExecutionTime),
        fastExecutions: this.metrics.performanceMetrics.fastExecutions,
        slowExecutions: this.metrics.performanceMetrics.slowExecutions,
        timeouts: this.metrics.performanceMetrics.timeouts
      },
      financial: {
        totalProfit: this.metrics.totalProfit.toFixed(6),
        totalGasCost: (this.metrics.totalGasCost / 1e18).toFixed(6), // Convert to ETH
        netProfit: (this.metrics.totalProfit - this.metrics.totalGasCost / 1e18).toFixed(6)
      },
      errors: this.getTopErrors()
    };
    
    logger.info('Metrics Report:', report);
    
    // Send to CloudWatch if configured
    this.sendToCloudWatch(report);
  }

  getTopErrors(limit = 5) {
    const errors = Array.from(this.metrics.errors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([error, count]) => ({ error, count }));
    
    return errors;
  }

  async sendToCloudWatch(metrics) {
    if (!process.env.AWS_REGION || process.env.NODE_ENV !== 'production') {
      return;
    }
    
    try {
      // This would integrate with AWS CloudWatch Metrics
      // For now, we'll just log the metrics
      logger.info('CloudWatch Metrics:', {
        namespace: 'LiquidationBot',
        metrics: {
          'LiquidationsAttempted': this.metrics.liquidationsAttempted,
          'LiquidationsSuccessful': this.metrics.liquidationsSuccessful,
          'SuccessRate': this.getSuccessRate(),
          'AverageExecutionTime': this.metrics.averageExecutionTime,
          'TotalProfit': this.metrics.totalProfit,
          'Uptime': this.getUptime()
        }
      });
      
    } catch (error) {
      logger.error('Failed to send metrics to CloudWatch:', error);
    }
  }

  getMetricsSummary() {
    return {
      uptime: this.getUptime(),
      successRate: this.getSuccessRate(),
      totalLiquidations: this.metrics.liquidationsAttempted,
      averageExecutionTime: this.metrics.averageExecutionTime,
      totalProfit: this.metrics.totalProfit,
      performanceMetrics: this.metrics.performanceMetrics,
      topErrors: this.getTopErrors()
    };
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    logger.info('Stopping metrics collector...');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Final metrics report
    this.reportMetrics();
    
    this.isRunning = false;
    logger.info('Metrics collector stopped');
  }
}
