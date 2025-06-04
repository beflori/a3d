# Base L2 Liquidation Bot

A high-performance liquidation bot designed for Base L2 chain, optimized for sub-200ms transaction execution.

## Features

- 🚀 **Ultra-fast execution** - Sub-200ms transaction preparation and submission
- 🔗 **Multi-protocol support** - Compound V3, Aave V3, Moonwell, and custom protocols
- 📊 **Real-time monitoring** - WebSocket event listening with automatic reconnection
- ⛽ **Smart gas optimization** - Dynamic gas pricing based on network conditions
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

## Quick Start

### Prerequisites

- Node.js 20.x or higher
- AWS account (for deployment and CloudWatch)
- Base RPC endpoints (Infura, Alchemy, or self-hosted)
- Private key with ETH for gas fees

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
```

## Deployment

Use the automated deployment script:
```bash
./scripts/deploy.sh
```

## Monitoring

Health endpoints available at:
- `GET /health` - Basic health check
- `GET /metrics` - Performance metrics
- `GET /status` - Detailed bot status

⚠️ **Disclaimer**: Test thoroughly before mainnet deployment. Use at your own risk.