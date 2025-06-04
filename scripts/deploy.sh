#!/bin/bash

# AWS EC2 Deployment Script for Base Liquidation Bot
# This script sets up the liquidation bot on an AWS EC2 instance

set -e

echo "🚀 Starting Base Liquidation Bot deployment..."

# Update system
echo "📦 Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Node.js 20.x
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install AWS CLI
echo "📦 Installing AWS CLI..."
sudo apt-get install -y awscli

# Create application directory
APP_DIR="/opt/liquidation-bot"
echo "📁 Creating application directory: $APP_DIR"
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# Clone or copy application files
echo "📥 Setting up application files..."
cd $APP_DIR

# If running from git repository
if [ -d ".git" ]; then
    git pull origin main
else
    # Copy files from current directory
    cp -r /home/beflori/github/a3d/* .
fi

# Install dependencies
echo "📦 Installing application dependencies..."
npm install --production

# Create logs directory
sudo mkdir -p /var/log/liquidation-bot
sudo chown $USER:$USER /var/log/liquidation-bot

# Setup environment variables
echo "⚙️ Setting up environment variables..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "🔧 Please edit .env file with your configuration"
    echo "🔧 Required variables:"
    echo "   - RPC_URL, WSS_URL, PRIVATE_KEY"
    echo "   - AWS credentials for CloudWatch"
    echo "   - Protocol contract addresses"
fi

# Setup PM2 ecosystem file
echo "⚙️ Creating PM2 ecosystem file..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'liquidation-bot',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/liquidation-bot/error.log',
    out_file: '/var/log/liquidation-bot/out.log',
    log_file: '/var/log/liquidation-bot/combined.log',
    time: true,
    merge_logs: true
  }]
};
EOF

# Setup log rotation
echo "📝 Setting up log rotation..."
sudo tee /etc/logrotate.d/liquidation-bot > /dev/null << 'EOF'
/var/log/liquidation-bot/*.log {
    daily
    missingok
    rotate 30
    compress
    notifempty
    create 0644 ubuntu ubuntu
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

# Setup systemd service for PM2
echo "🔧 Setting up systemd service..."
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME

# Create health check script
echo "🏥 Creating health check script..."
cat > health-check.sh << 'EOF'
#!/bin/bash
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ $response -eq 200 ]; then
    echo "✅ Bot is healthy"
    exit 0
else
    echo "❌ Bot is unhealthy (HTTP $response)"
    exit 1
fi
EOF
chmod +x health-check.sh

# Setup CloudWatch agent (optional)
if command -v amazon-cloudwatch-agent-ctl &> /dev/null; then
    echo "📊 Setting up CloudWatch agent..."
    cat > /tmp/cloudwatch-config.json << 'EOF'
{
    "logs": {
        "logs_collected": {
            "files": {
                "collect_list": [
                    {
                        "file_path": "/var/log/liquidation-bot/*.log",
                        "log_group_name": "/aws/ec2/liquidation-bot",
                        "log_stream_name": "{instance_id}",
                        "timezone": "UTC"
                    }
                ]
            }
        }
    }
}
EOF
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
        -a fetch-config -m ec2 -c file:/tmp/cloudwatch-config.json -s
fi

echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Start the bot: pm2 start ecosystem.config.js"
echo "3. Save PM2 configuration: pm2 save"
echo "4. Monitor logs: pm2 logs liquidation-bot"
echo ""
echo "Useful commands:"
echo "- pm2 status                 # Check bot status"
echo "- pm2 restart liquidation-bot  # Restart bot"
echo "- pm2 stop liquidation-bot     # Stop bot"
echo "- ./health-check.sh           # Check bot health"
