#!/bin/bash

# AWS EC2 Deployment Script for Base Liquidation Bot
# This script sets up the liquidation bot on an AWS EC2 instance
# Compatible with Amazon Linux 2/2023

set -e

echo "🚀 Starting Base Liquidation Bot deployment..."

# Detect OS and set package manager
if [ -f /etc/amazon-linux-release ] || [ -f /etc/system-release ]; then
    echo "� Detected Amazon Linux - using yum package manager"
    PKG_MANAGER="yum"
    PKG_UPDATE="sudo yum update -y"
    PKG_INSTALL="sudo yum install -y"
else
    echo "📋 Detected Ubuntu/Debian - using apt package manager"
    PKG_MANAGER="apt"
    PKG_UPDATE="sudo apt-get update -y && sudo apt-get upgrade -y"
    PKG_INSTALL="sudo apt-get install -y"
fi

# Update system
echo "📦 Updating system packages..."
eval $PKG_UPDATE

# Install Node.js 20.x
echo "📦 Installing Node.js..."
if [ "$PKG_MANAGER" = "yum" ]; then
    # Amazon Linux - install Node.js 20.x
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
else
    # Ubuntu/Debian
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2 for process management
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install AWS CLI
echo "📦 Installing AWS CLI..."
if [ "$PKG_MANAGER" = "yum" ]; then
    # Amazon Linux - install AWS CLI v2
    sudo yum install -y awscli
else
    # Ubuntu/Debian
    sudo apt-get install -y awscli
fi

# Create application directory
APP_DIR="/opt/liquidation-bot"
echo "📁 Creating application directory: $APP_DIR"
sudo mkdir -p $APP_DIR

# Change ownership based on OS
if [ "$PKG_MANAGER" = "yum" ]; then
    sudo chown ec2-user:ec2-user $APP_DIR
else
    sudo chown $USER:$USER $APP_DIR
fi

# Clone or copy application files
echo "📥 Setting up application files..."
cd $APP_DIR

# If running from git repository
if [ -d ".git" ]; then
    git pull origin main
else
    # Copy files from current directory
    cp -r /home/ec2-user/a3d/* .
fi

# Install dependencies
echo "📦 Installing application dependencies..."
npm install --production

# Create logs directory
sudo mkdir -p /var/log/liquidation-bot
if [ "$PKG_MANAGER" = "yum" ]; then
    sudo chown ec2-user:ec2-user /var/log/liquidation-bot
else
    sudo chown $USER:$USER /var/log/liquidation-bot
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
if [ "$PKG_MANAGER" = "yum" ]; then
    sudo tee /etc/logrotate.d/liquidation-bot > /dev/null << 'EOF'
/var/log/liquidation-bot/*.log {
    daily
    missingok
    rotate 30
    compress
    notifempty
    create 0644 ec2-user ec2-user
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
else
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
fi

# Setup systemd service for PM2
echo "🔧 Setting up systemd service..."
if [ "$PKG_MANAGER" = "yum" ]; then
    sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user
else
    sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME
fi

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
