module.exports = {
  apps: [{
    name: 'liquidation-bot',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    },
    env_development: {
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug'
    },
    error_file: '/var/log/liquidation-bot/error.log',
    out_file: '/var/log/liquidation-bot/out.log',
    log_file: '/var/log/liquidation-bot/combined.log',
    time: true,
    merge_logs: true
  }]
};
