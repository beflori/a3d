# Base L2 Liquidation Bot

A high-performance liquidation bot designed for Base L2 chain, optimized for sub-200ms transaction execution.

## Features

- 🚀 **Ultra-fast execution** - Sub-200ms transaction preparation and submission
- 🔗 **Multi-protocol support** - Compound V3, Aave V3, Moonwell, and custom protocols
- 📊 **Real-time monitoring** - WebSocket event listening with automatic reconnection
- 💰 **Wallet balance validation** - Prevents failed liquidations due to insufficient debt tokens
- 💲 **Real-time price feeds** - Multi-source price oracle with Chainlink, CoinGecko, and DEX fallbacks
- ⛽ **Smart gas optimization** - Dynamic gas pricing based on network conditions
- 🔄 **Intelligent caching** - Reduced API usage from ~130k/day to ~3k/day through optimized polling
- 📈 **Comprehensive metrics** - Performance tracking and AWS CloudWatch integration
- 🔄 **Robust error handling** - Automatic retries and graceful failure recovery
- 🏥 **Health monitoring** - Built-in health checks and alerting

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Event         │    │   Opportunity    │    │   Transaction   │
│   Listener      ├────►   Validator      ├────►   Executor      │
│   (WebSocket)   │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │      LiquidationBot        │
                    │     (Main Orchestrator)    │
                    └─────────────┬──────────────┘
                                  │
    ┌─────────────────────────────┼─────────────────────────────┐
    │                             │                             │
┌───▼────┐    ┌──────▼──────┐    ┌▼──────────────┐    ┌────▼────┐
│  Gas   │    │   Metrics   │    │    Health     │    │ Logger  │
│ Oracle │    │ Collector   │    │    Server     │    │ (Winston│
└────────┘    └─────────────┘    └───────────────┘    │ +CloudW)│
                                                      └─────────┘
```

## Core Components

### 🎯 **LiquidationBot** (`src/core/LiquidationBot.js`)
The main orchestrator that initializes and coordinates all services. Manages the complete liquidation workflow from event detection to execution.

### 👂 **EventListener** (`src/services/EventListener.js`)
Monitors blockchain events via WebSocket connections to detect liquidation opportunities in real-time. Automatically reconnects on connection failures.

### ✅ **OpportunityValidator** (`src/services/OpportunityValidator.js`)
Analyzes detected opportunities to determine profitability and feasibility. Includes:
- Real-time position data fetching from protocols (Compound V3, Aave V3, Moonwell)
- Wallet balance validation for debt tokens
- Profitability calculations with gas cost estimation
- Enhanced 30-second position caching to reduce API calls

### 💰 **PriceOracle** (`src/services/PriceOracle.js`)
Provides real-time token pricing with multiple data sources and caching:
- **Primary**: Chainlink price feeds for maximum accuracy
- **Fallback**: CoinGecko API for additional tokens
- **Emergency**: DEX price discovery via Uniswap V3
- **2-minute cache** to dramatically reduce API usage
- Supports Base mainnet tokens (WETH, USDC, cbETH, etc.)

### ⚡ **TransactionExecutor** (`src/services/TransactionExecutor.js`)
Handles the actual liquidation transaction execution with optimized gas pricing and error handling.

### ⛽ **GasOracle** (`src/services/GasOracle.js`)
Monitors network gas prices and provides dynamic pricing strategies. **Now polls every 2 minutes** instead of 2 seconds to reduce API usage.

### 📊 **MetricsCollector** (`src/services/MetricsCollector.js`)
Tracks performance metrics, success rates, and profitability statistics for monitoring and optimization.

### 🏥 **HealthServer** (`src/services/HealthServer.js`)
Provides HTTP endpoints for health monitoring, metrics reporting, and integration with monitoring systems.

## Quick Start

### Prerequisites

- Node.js 20.x or higher
- AWS account (for deployment and CloudWatch)
- Base RPC endpoints (Infura, Alchemy, or self-hosted)
- Private key with ETH for gas fees
- **Debt tokens for liquidations** (USDC, WETH, cbETH, etc.) or flash loan setup

> ⚠️ **Important**: The bot now validates wallet balances for debt tokens. Ensure your wallet has sufficient tokens for the liquidations you want to execute, or configure flash loans.

### Installation

1. **Clone and setup**:
   ```bash
   git clone <repository>
   cd base-liquidation-bot
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Run locally**:
   ```bash
   npm run dev
   ```

## Environment Variables

#### Required
```bash
# Network Configuration
RPC_URL=https://mainnet.base.org
WSS_URL=wss://mainnet.base.org
CHAIN_ID=8453
PRIVATE_KEY=your_private_key_here

# Wallet Balance Validation
ENABLE_WALLET_BALANCE_CHECK=true    # Enable/disable balance validation (default: true)
SUGGEST_FLASH_LOANS=false           # Show flash loan suggestions (default: false)
```

## API Usage Optimization

The bot has been optimized to dramatically reduce RPC API calls:

### Before Optimization
- **Gas Oracle**: Polling every 2 seconds = ~130,000 calls/day
- **Block monitoring**: 1-second intervals = ~86,400 calls/day
- **Connection checks**: Every 30 seconds
- **Total**: ~216,000+ calls/day

### After Optimization ✅
- **Gas Oracle**: Polling every 2 minutes = ~720 calls/day
- **Block monitoring**: 12-second intervals = ~7,200 calls/day
- **Connection checks**: Every 5 minutes
- **Position caching**: 30-second cache for position data
- **Price caching**: 2-minute cache for token prices
- **Balance caching**: 15-second cache for wallet balances
- **Total**: ~3,000 calls/day (99% reduction!)

This optimization makes the bot much more cost-effective while maintaining performance for rare liquidation events.

## Deployment

Use the automated deployment script:
```bash
./scripts/deploy.sh
```

## Monitoring

Health endpoints available at:
- `GET /health` - Basic health check including PriceOracle status
- `GET /metrics` - Performance metrics and liquidation statistics
- `GET /status` - Detailed bot status with uptime and active liquidations
- `GET /price-oracle` - **New!** PriceOracle health and cached prices
- `GET /ready` - Kubernetes readiness probe endpoint

### Example Health Response
```json
{
  "status": "healthy",
  "timestamp": "2025-06-08T06:58:51.400Z",
  "uptime": 3600000,
  "activeLiquidations": 0,
  "walletAddress": "0x...",
  "priceOracle": {
    "healthy": true,
    "cacheSize": 5,
    "lastETHPrice": "2515.23",
    "lastUpdate": 1749365931399,
    "supportedTokens": 7
  }
}
```

⚠️ **Disclaimer**: Test thoroughly before mainnet deployment. Use at your own risk.