# Protocol Contract Addresses for Base Mainnet
# Update these with actual contract addresses when deploying

# Compound V3 Contracts
COMPOUND_V3_USDC_ADDRESS=0x...
COMPOUND_V3_ETH_ADDRESS=0x...

# Aave V3 Contracts  
AAVE_V3_POOL_ADDRESS=0x...
AAVE_V3_ORACLE_ADDRESS=0x...

# Moonwell Contracts (Base-specific)
MOONWELL_COMPTROLLER=0x...
MOONWELL_ORACLE=0x...

# Base-specific tokens
USDC_BASE=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
WETH_BASE=0x4200000000000000000000000000000000000006
CBETH_BASE=0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22

# DEX addresses for potential arbitrage
UNISWAP_V3_ROUTER=0x2626664c2603336E57B271c5C0b26F421741e481
AERODROME_ROUTER=0x...

export const BASE_PROTOCOL_ADDRESSES = {
  compound: {
    usdc: process.env.COMPOUND_V3_USDC_ADDRESS,
    eth: process.env.COMPOUND_V3_ETH_ADDRESS,
  },
  aave: {
    pool: process.env.AAVE_V3_POOL_ADDRESS,
    oracle: process.env.AAVE_V3_ORACLE_ADDRESS,
  },
  moonwell: {
    comptroller: process.env.MOONWELL_COMPTROLLER,
    oracle: process.env.MOONWELL_ORACLE,
  },
  tokens: {
    usdc: process.env.USDC_BASE || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    weth: process.env.WETH_BASE || '0x4200000000000000000000000000000000000006',
    cbeth: process.env.CBETH_BASE || '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  },
  dex: {
    uniswapV3: process.env.UNISWAP_V3_ROUTER || '0x2626664c2603336E57B271c5C0b26F421741e481',
    aerodrome: process.env.AERODROME_ROUTER,
  }
};
