#!/bin/bash

# Run both the frontend and the api in development mode using PM2

# Function to show help menu
show_help() {
    echo "Usage: $0 [-b|--background] [-h|--help]"
    echo ""
    echo "Options:"
    echo "  -b, --background    Start services in background (no monitoring interface)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "By default, services start with monitoring interface."
    echo "Use the following commands to manage services:"
    echo "  npx pm2 status     - Show status of all services"
    echo "  npx pm2 logs       - Show logs from all services"
    echo "  npx pm2 logs frontend - Show logs from frontend only"
    echo "  npx pm2 logs api   - Show logs from API only"
    echo "  npx pm2 stop all   - Stop all services"
    echo "  npx pm2 restart all - Restart all services"
    echo "  npx pm2 delete all - Delete all services from PM2"
    echo "  npx pm2 monit     - Start monitoring interface"
}

# Parse command line arguments
BACKGROUND=false
while getopts "bh" opt; do
    case $opt in
        b)
            BACKGROUND=true
            ;;
        h)
            show_help
            exit 0
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            show_help
            exit 1
            ;;
    esac
done

# Create logs directory if it doesn't exist
mkdir -p logs

# Start both services using PM2
echo "Starting services with PM2..."
npx pm2 start ./scripts/pm2-all.config.js

echo "Services started! Use the following commands to manage them:"
echo "  npx pm2 status     - Show status of all services"
echo "  npx pm2 logs       - Show logs from all services"
echo "  npx pm2 logs frontend - Show logs from frontend only"
echo "  npx pm2 logs api   - Show logs from API only"
echo "  npx pm2 stop all   - Stop all services"
echo "  npx pm2 restart all - Restart all services"
echo "  npx pm2 delete all - Delete all services from PM2"
echo ""

# Only run monit if background mode is NOT enabled
if [ "$BACKGROUND" = false ]; then
    echo "Starting monit monitoring interface..."
    npx pm2 monit
    trap "npx pm2 stop all" EXIT
else
    echo "Services are running in background. Use 'npx pm2 monit' to start the monitoring interface."
fi

