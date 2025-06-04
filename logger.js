import winston from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';

const isProduction = process.env.NODE_ENV === 'production';

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  })
];

// Add CloudWatch transport in production
if (isProduction && process.env.AWS_REGION) {
  transports.push(
    new WinstonCloudWatch({
      logGroupName: process.env.CLOUDWATCH_LOG_GROUP || '/aws/ec2/liquidation-bot',
      logStreamName: `liquidation-bot-${new Date().toISOString().split('T')[0]}`,
      awsRegion: process.env.AWS_REGION,
      messageFormatter: ({ level, message, timestamp, ...meta }) => {
        return JSON.stringify({
          timestamp,
          level,
          message,
          ...meta
        });
      }
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  exitOnError: false
});

// Add performance logging helpers
logger.performance = (label, startTime) => {
  const duration = Date.now() - startTime;
  logger.info(`Performance: ${label} took ${duration}ms`);
  return duration;
};

logger.liquidation = (data) => {
  logger.info('Liquidation Event', data);
};

logger.opportunity = (data) => {
  logger.info('Liquidation Opportunity', data);
};

logger.transaction = (data) => {
  logger.info('Transaction', data);
};

export default logger;
