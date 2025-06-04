#!/bin/bash

# Health monitoring script for the liquidation bot
# This script can be run by cron or external monitoring systems

HEALTH_URL="http://localhost:3000/health"
LOG_FILE="/var/log/liquidation-bot/health-monitor.log"
MAX_FAILURES=3
FAILURE_COUNT_FILE="/tmp/liquidation-bot-failures"

# Initialize failure counter
if [ ! -f "$FAILURE_COUNT_FILE" ]; then
    echo "0" > "$FAILURE_COUNT_FILE"
fi

# Function to log with timestamp
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Function to reset failure counter
reset_failures() {
    echo "0" > "$FAILURE_COUNT_FILE"
}

# Function to increment failure counter
increment_failures() {
    local failures=$(cat "$FAILURE_COUNT_FILE")
    failures=$((failures + 1))
    echo "$failures" > "$FAILURE_COUNT_FILE"
    echo "$failures"
}

# Function to restart the bot
restart_bot() {
    log_message "🔄 Restarting liquidation bot due to health check failures..."
    pm2 restart liquidation-bot
    
    # Wait for restart
    sleep 10
    
    # Check if restart was successful
    if pm2 describe liquidation-bot | grep -q "online"; then
        log_message "✅ Bot restarted successfully"
        reset_failures
        
        # Send alert about restart
        send_alert "RESTART" "Liquidation bot was restarted due to health check failures"
    else
        log_message "❌ Bot restart failed"
        send_alert "CRITICAL" "Liquidation bot restart failed - manual intervention required"
    fi
}

# Function to send alerts (customize based on your alerting system)
send_alert() {
    local severity="$1"
    local message="$2"
    
    log_message "🚨 ALERT [$severity]: $message"
    
    # Example: Send to AWS SNS
    if [ ! -z "$AWS_SNS_TOPIC_ARN" ]; then
        aws sns publish \
            --topic-arn "$AWS_SNS_TOPIC_ARN" \
            --message "$message" \
            --subject "Liquidation Bot Alert - $severity" \
            > /dev/null 2>&1
    fi
    
    # Example: Send to Slack webhook
    if [ ! -z "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🤖 Liquidation Bot Alert [$severity]: $message\"}" \
            "$SLACK_WEBHOOK_URL" > /dev/null 2>&1
    fi
    
    # Example: Send email via sendmail
    if command -v sendmail &> /dev/null && [ ! -z "$ALERT_EMAIL" ]; then
        echo -e "Subject: Liquidation Bot Alert - $severity\n\n$message" | \
            sendmail "$ALERT_EMAIL"
    fi
}

# Main health check
log_message "🏥 Starting health check..."

# Check if PM2 process is running
if ! pm2 describe liquidation-bot | grep -q "online"; then
    log_message "❌ PM2 process is not online"
    increment_failures
    send_alert "WARNING" "Liquidation bot PM2 process is not online"
    restart_bot
    exit 1
fi

# Check health endpoint
response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL")

if [ "$response" -eq 200 ]; then
    log_message "✅ Health check passed (HTTP $response)"
    reset_failures
    
    # Get detailed status
    status=$(curl -s --max-time 5 "$HEALTH_URL" | jq -r '.status // "unknown"')
    uptime=$(curl -s --max-time 5 "http://localhost:3000/metrics" | jq -r '.uptime // 0')
    
    log_message "📊 Status: $status, Uptime: ${uptime}ms"
    
elif [ "$response" -eq 503 ]; then
    log_message "⚠️ Service unavailable (HTTP $response)"
    failures=$(increment_failures)
    
    if [ "$failures" -ge "$MAX_FAILURES" ]; then
        send_alert "WARNING" "Liquidation bot health check failed $failures times (HTTP $response)"
        restart_bot
    fi
    
else
    log_message "❌ Health check failed (HTTP $response)"
    failures=$(increment_failures)
    
    if [ "$failures" -ge "$MAX_FAILURES" ]; then
        send_alert "CRITICAL" "Liquidation bot health check failed $failures times (HTTP $response)"
        restart_bot
    fi
fi

# Check system resources
cpu_usage=$(ps -p $(pgrep -f "liquidation-bot") -o %cpu= 2>/dev/null | awk '{print $1}' | head -1)
mem_usage=$(ps -p $(pgrep -f "liquidation-bot") -o %mem= 2>/dev/null | awk '{print $1}' | head -1)

if [ ! -z "$cpu_usage" ] && [ ! -z "$mem_usage" ]; then
    log_message "💻 Resources: CPU ${cpu_usage}%, Memory ${mem_usage}%"
    
    # Alert on high resource usage
    if (( $(echo "$cpu_usage > 80" | bc -l) )); then
        send_alert "WARNING" "High CPU usage: ${cpu_usage}%"
    fi
    
    if (( $(echo "$mem_usage > 80" | bc -l) )); then
        send_alert "WARNING" "High memory usage: ${mem_usage}%"
    fi
fi

log_message "🏥 Health check completed"
