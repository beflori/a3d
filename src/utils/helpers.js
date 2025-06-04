import { ethers } from 'ethers';

export class ProtocolUtils {
  static getProtocolConfig(protocol) {
    const configs = {
      'compound-v3': {
        liquidationThreshold: 0.85,
        liquidationBonus: 0.05,
        maxLiquidationRatio: 0.5
      },
      'aave-v3': {
        liquidationThreshold: 0.80,
        liquidationBonus: 0.10,
        maxLiquidationRatio: 0.5
      }
    };
    
    return configs[protocol] || configs['aave-v3'];
  }

  static calculateMaxLiquidation(debtAmount, protocol) {
    const config = this.getProtocolConfig(protocol);
    return debtAmount * config.maxLiquidationRatio;
  }

  static calculateCollateralSeized(debtAmount, collateralPrice, debtPrice, protocol) {
    const config = this.getProtocolConfig(protocol);
    const collateralValue = (debtAmount * debtPrice) * (1 + config.liquidationBonus);
    return collateralValue / collateralPrice;
  }
}

export class AddressUtils {
  static isValidAddress(address) {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  }

  static formatAddress(address) {
    if (!this.isValidAddress(address)) {
      return 'Invalid Address';
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}

export class TimeUtils {
  static now() {
    return Date.now();
  }

  static formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  static isWithinTimeout(startTime, timeoutMs) {
    return Date.now() - startTime < timeoutMs;
  }
}

export class RetryUtils {
  static async withRetry(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (i < maxRetries) {
          await this.sleep(delay * Math.pow(2, i)); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class ValidationUtils {
  static validateEnvironmentVariables(required) {
    const missing = [];
    
    for (const envVar of required) {
      if (!process.env[envVar]) {
        missing.push(envVar);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  static validateNumber(value, min, max, name) {
    const num = Number(value);
    
    if (isNaN(num)) {
      throw new Error(`${name} must be a valid number`);
    }
    
    if (min !== undefined && num < min) {
      throw new Error(`${name} must be >= ${min}`);
    }
    
    if (max !== undefined && num > max) {
      throw new Error(`${name} must be <= ${max}`);
    }
    
    return num;
  }
}
