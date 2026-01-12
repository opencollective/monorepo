#!/bin/bash

COMPOSE_DIR="opencollective-api/docker-compose"

# Discover available services from docker-compose files
available_services=()
for file in "$COMPOSE_DIR"/*.yml; do
    if [ -f "$file" ]; then
        service_name=$(basename "$file" .yml)
        available_services+=("$service_name")
    fi
done

# Check if services are provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <service1> [service2] [service3] ..."
    echo "Available services: ${available_services[*]}"
    exit 1
fi

# Build the compose file arguments based on provided services
compose_files=()
for service in "$@"; do
    # Check if service is valid
    valid=false
    for valid_service in "${available_services[@]}"; do
        if [ "$service" = "$valid_service" ]; then
            valid=true
            compose_files+=(-f "$COMPOSE_DIR/$service.yml")
            break
        fi
    done
    
    if [ "$valid" = false ]; then
        echo "Unknown service: $service"
        echo "Available services: ${available_services[*]}"
        exit 1
    fi
done

# Start the specified services
podman compose "${compose_files[@]}" up