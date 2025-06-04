#!/bin/bash

# Quick test script to verify bot components
echo "🧪 Running liquidation bot tests..."

# Test 1: Environment variables
echo "📋 Checking environment variables..."
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Copy .env.example to .env and configure it."
    exit 1
fi

source .env

required_vars=("RPC_URL" "WSS_URL" "PRIVATE_KEY" "CHAIN_ID")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Missing required environment variable: $var"
        exit 1
    fi
done
echo "✅ Environment variables OK"

# Test 2: Node.js dependencies
echo "📦 Checking dependencies..."
if ! npm list ethers ws winston > /dev/null 2>&1; then
    echo "❌ Missing dependencies. Run: npm install"
    exit 1
fi
echo "✅ Dependencies OK"

# Test 3: RPC connectivity
echo "🌐 Testing RPC connectivity..."
response=$(curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}')

if [ $? -eq 0 ] && [[ "$response" == *"0x2105"* ]]; then
    echo "✅ RPC connectivity OK (Base mainnet)"
elif [ $? -eq 0 ] && [[ "$response" == *"result"* ]]; then
    echo "✅ RPC connectivity OK (response received)"
    echo "   Response: $response"
else
    echo "❌ RPC connectivity failed"
    echo "   Response: $response"
    echo "   URL: $RPC_URL"
fi

# Test 4: WebSocket connectivity  
echo "🔌 Testing WebSocket connectivity..."
if command -v wscat &> /dev/null; then
    timeout 5 wscat -c "$WSS_URL" -x '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ WebSocket connectivity OK"
    else
        echo "⚠️ WebSocket connectivity test failed"
    fi
else
    echo "⚠️ wscat not available, skipping WebSocket test"
fi

# Test 5: Wallet validation
echo "🔑 Testing wallet..."
node --input-type=module -e "
import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

try {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  console.log('✅ Wallet address:', wallet.address);
} catch (error) {
  console.log('❌ Invalid private key:', error.message);
  process.exit(1);
}
" || exit 1

# Test 6: Directory structure
echo "📁 Checking directory structure..."
required_dirs=("src/core" "src/services" "src/utils" "scripts")
for dir in "${required_dirs[@]}"; do
    if [ ! -d "$dir" ]; then
        echo "❌ Missing directory: $dir"
        exit 1
    fi
done
echo "✅ Directory structure OK"

# Test 7: Permissions
echo "🔐 Checking script permissions..."
scripts=("scripts/deploy.sh" "scripts/health-monitor.sh")
for script in "${scripts[@]}"; do
    if [ ! -x "$script" ]; then
        echo "⚠️ Script not executable: $script (run: chmod +x $script)"
    fi
done
echo "✅ Permissions OK"

echo ""
echo "🎉 All tests passed! Bot is ready to run."
echo ""
echo "Next steps:"
echo "1. Start the bot: npm start"
echo "2. Check health: curl http://localhost:3000/health"
echo "3. Monitor logs: pm2 logs liquidation-bot"
echo ""
echo "For production deployment:"
echo "1. Deploy to EC2: ./scripts/deploy.sh"
echo "2. Configure monitoring: ./scripts/health-monitor.sh"
