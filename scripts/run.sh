#!/bin/bash

# Run services in development mode using PM2
# Supports: ./scripts/run.sh [frontend] [api] [pdf] [service:env]

# Function to show help menu
show_help() {
    echo "Usage: $0 [-b|--background] [-h|--help] [service[:env]]..."
    echo ""
    echo "Options:"
    echo "  -b, --background    Start services in background (no monitoring interface)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Services:"
    echo "  frontend           Start frontend service"
    echo "  api                Start API service"
    echo "  pdf                Start PDF service"
    echo "  rest               Start REST API service"
    echo "  images             Start images service"
    echo ""
    echo "Examples:"
    echo "  $0                 Start frontend and API (default)"
    echo "  $0 frontend        Start frontend only"
    echo "  $0 frontend:staging Start frontend with staging environment"
    echo "  $0 frontend api    Start frontend and API"
    echo "  $0 frontend:staging api Start frontend (staging) and API"
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

# Available services configuration
declare -A SERVICE_CONFIG
SERVICE_CONFIG[frontend]="opencollective-frontend"
SERVICE_CONFIG[api]="opencollective-api"
SERVICE_CONFIG[pdf]="opencollective-pdf"
SERVICE_CONFIG[rest]="opencollective-rest"
SERVICE_CONFIG[images]="opencollective-images"

# Parse command line arguments
BACKGROUND=false
SERVICES=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--background)
            BACKGROUND=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            echo "Invalid option: $1" >&2
            show_help
            exit 1
            ;;
        *)
            SERVICES+=("$1")
            shift
            ;;
    esac
done

# Create logs directory if it doesn't exist
mkdir -p logs

# Function to generate PM2 config
generate_pm2_config() {
    local config_file="$1"
    local services_json="["
    local first=true

    for service_spec in "${SERVICES[@]}"; do
        # Split service:env
        IFS=':' read -r service_name env <<< "$service_spec"
        
        # Validate service name
        if [[ ! -v SERVICE_CONFIG[$service_name] ]]; then
            echo "Error: Unknown service '$service_name'. Available services: ${!SERVICE_CONFIG[@]}" >&2
            exit 1
        fi

        local service_dir="${SERVICE_CONFIG[$service_name]}"
        
        # Build npm args
        local npm_args="run dev"
        if [[ -n "$env" ]]; then
            npm_args="run dev $env"
        fi

        # Add comma if not first
        if [ "$first" = false ]; then
            services_json+=","
        fi
        first=false

        services_json+="
    {
      \"name\": \"$service_name\",
      \"cwd\": \"./$service_dir\",
      \"script\": \"npm\",
      \"args\": \"$npm_args\",
      \"log_file\": \"../logs/$service_name.log\",
      \"out_file\": \"../logs/$service_name-out.log\",
      \"error_file\": \"../logs/$service_name-error.log\"
    }"
    done

    services_json+="
  ]"

    echo "module.exports = {
  apps: $services_json
};" > "$config_file"
}

# If no services specified, default to frontend and API
if [ ${#SERVICES[@]} -eq 0 ]; then
    echo "Starting default services (frontend and API) with PM2..."
    SERVICES=("frontend" "api")
    TEMP_CONFIG="./scripts/pm2-temp.config.js"
    generate_pm2_config "$TEMP_CONFIG"
    
    echo "Starting services with PM2..."
    echo "Services: ${SERVICES[*]}"
    npx pm2 start "$TEMP_CONFIG"
    
    # Clean up temp config
    rm -f "$TEMP_CONFIG"
else
    # Generate dynamic config
    TEMP_CONFIG="./scripts/pm2-temp.config.js"
    generate_pm2_config "$TEMP_CONFIG"
    
    echo "Starting services with PM2..."
    echo "Services: ${SERVICES[*]}"
    npx pm2 start "$TEMP_CONFIG"
    
    # Clean up temp config
    rm -f "$TEMP_CONFIG"
fi

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

