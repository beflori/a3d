module.exports = {
  apps: [{
    name: 'liquidation-bot',
    script: '/home/ec2-user/a3d/src/index.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    error_file: '/var/log/liquidation-bot/error.log',
    out_file: '/var/log/liquidation-bot/out.log',
    log_file: '/var/log/liquidation-bot/combined.log',
    time: true
  }]
};
