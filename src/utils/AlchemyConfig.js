import { ethers } from 'ethers';

export class AlchemyConfig {
  static getEndpoints() {
    const apiKey = process.env.ALCHEMY_API_KEY;
    
    if (!apiKey) {
      throw new Error('ALCHEMY_API_KEY environment variable is required');
    }
    
    // Build URLs with API key
    const rpcUrl = process.env.RPC_URL?.includes('${ALCHEMY_API_KEY}') 
      ? process.env.RPC_URL.replace('${ALCHEMY_API_KEY}', apiKey)
      : process.env.RPC_URL;
      
    const wssUrl = process.env.WSS_URL?.includes('${ALCHEMY_API_KEY}')
      ? process.env.WSS_URL.replace('${ALCHEMY_API_KEY}', apiKey)
      : process.env.WSS_URL;
    
    return {
      rpcUrl,
      wssUrl,
      apiKey
    };
  }
  
  static createProviders() {
    const { rpcUrl, wssUrl } = this.getEndpoints();
    
    // Create HTTP provider for regular RPC calls
    const provider = new ethers.JsonRpcProvider(rpcUrl, {
      name: 'base',
      chainId: parseInt(process.env.CHAIN_ID || '8453')
    });
    
    // Create WebSocket provider for real-time events
    const wsProvider = new ethers.WebSocketProvider(wssUrl, {
      name: 'base',
      chainId: parseInt(process.env.CHAIN_ID || '8453')
    });
    
    // Configure provider options for better performance
    provider.pollingInterval = 12000; // 12 second polling (reduced from 1 second)
    
    return { provider, wsProvider };
  }
  
  static getAlchemyFeatures() {
    return {
      // Alchemy-specific features you can leverage
      supportsTraceApi: true,
      supportsEnhancedApis: true,
      supportsNotifyApi: true,
      supportsNftApi: true,
      maxRequestsPerSecond: 330, // Alchemy rate limit
      webhookSupport: true
    };
  }
}
