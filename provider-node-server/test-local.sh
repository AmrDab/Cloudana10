#!/bin/bash
# Local testing script for provider-node-server with game manifests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTS_DIR="$SCRIPT_DIR/../game-manifests"
SERVER_PORT="${PROVIDER_NODE_PORT:-4040}"
SERVER_URL="http://localhost:${SERVER_PORT}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  Cloudana Provider Node - Local Testing Tool       ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}\n"
}

print_usage() {
    echo -e "${YELLOW}Usage:${NC}"
    echo "  $0 start              - Start the provider node server"
    echo "  $0 deploy <game>      - Deploy a game manifest"
    echo "  $0 status <workload>  - Check workload status"
    echo "  $0 url <workload>     - Get live site URL"
    echo "  $0 list               - List available game manifests"
    echo "  $0 health             - Check server health"
    echo "  $0 logs <workload>    - View workload logs"
    echo "  $0 delete <workload>  - Delete a workload"
    echo "  $0 clean              - Clean all deployed workloads"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $0 start"
    echo "  $0 deploy supermario"
    echo "  $0 url 1              # Get URL for workload 1"
    echo "  $0 status 1"
    echo "  $0 logs workload-1-1"
    echo ""
}

check_server() {
    if ! curl -s "${SERVER_URL}/health" > /dev/null 2>&1; then
        echo -e "${RED}✗ Server is not running on ${SERVER_URL}${NC}"
        echo -e "${YELLOW}  Run: $0 start${NC}"
        return 1
    fi
    return 0
}

start_server() {
    echo -e "${BLUE}Starting provider node server...${NC}"
    
    # Check if .env exists, if not create from example
    if [ ! -f "$SCRIPT_DIR/.env" ]; then
        if [ -f "$SCRIPT_DIR/.env.example" ]; then
            echo -e "${YELLOW}Creating .env from .env.example...${NC}"
            cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        fi
    fi
    
    cd "$SCRIPT_DIR"
    
    # Install dependencies if needed or if node_modules is corrupted
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install
    elif [ ! -f "node_modules/.package-lock.json" ]; then
        echo -e "${YELLOW}Dependencies corrupted, reinstalling...${NC}"
        rm -rf node_modules package-lock.json
        npm install
    fi
    
    # Verify tsx is available
    if ! npx tsx --version > /dev/null 2>&1; then
        echo -e "${RED}✗ tsx not found, reinstalling dependencies...${NC}"
        rm -rf node_modules package-lock.json
        npm install
    fi
    
    echo -e "${GREEN}✓ Starting server on port ${SERVER_PORT}${NC}"
    echo -e "${CYAN}  Press Ctrl+C to stop${NC}\n"
    npm run dev
}

list_games() {
    echo -e "${BLUE}Available game manifests:${NC}\n"
    
    local games=(
        "supermario:Super Mario 🍄:1:pengbai/docker-supermario:8080"
        "tetris:Tetris 🧱:2:bsord/tetris:80"
        "pacman:Pac-Man 👻:3:yuravorobei/pacman-web:80"
        "minesweeper:Minesweeper 💣:4:creepto/minesweeper:3000"
        "memory-game:Memory Game 🎴:5:jungpilyu/memorygame:80"
        "snake-game:Snake Game 🐍:6:harish1551/snake-game:8000"
    )
    
    printf "%-20s %-25s %-12s %s\n" "FILE" "NAME" "WORKLOAD ID" "IMAGE"
    echo "────────────────────────────────────────────────────────────────────────────"
    
    for game in "${games[@]}"; do
        IFS=':' read -r file name wid image port <<< "$game"
        printf "%-20s %-25s %-12s %s\n" "$file" "$name" "$wid" "$image"
    done
    
    echo ""
    echo -e "${YELLOW}Deploy with:${NC} $0 deploy <file>"
}

deploy_game() {
    local game_name="$1"
    
    if [ -z "$game_name" ]; then
        echo -e "${RED}Error: Game name required${NC}"
        echo "Usage: $0 deploy <game-name>"
        list_games
        exit 1
    fi
    
    local manifest_file="${MANIFESTS_DIR}/${game_name}.json"
    
    if [ ! -f "$manifest_file" ]; then
        echo -e "${RED}✗ Manifest file not found: ${manifest_file}${NC}"
        echo ""
        list_games
        exit 1
    fi
    
    if ! check_server; then
        exit 1
    fi
    
    echo -e "${BLUE}Deploying ${game_name}...${NC}"
    echo -e "${CYAN}Reading manifest: ${manifest_file}${NC}"
    
    # Read the manifest and extract key fields
    local manifest_json=$(cat "$manifest_file")
    local workload_id=$(echo "$manifest_json" | jq -r '.workloadId')
    local instance_id=$(echo "$manifest_json" | jq -r '.instanceId')
    local namespace=$(echo "$manifest_json" | jq -r '.namespace')
    
    echo -e "${CYAN}  Workload ID: ${workload_id}${NC}"
    echo -e "${CYAN}  Instance ID: ${instance_id}${NC}"
    echo -e "${CYAN}  Namespace: ${namespace}${NC}\n"
    
    # Send deploy request to provider node
    local response=$(curl -s -X POST "${SERVER_URL}/deploy" \
        -H "Content-Type: application/json" \
        -d "$manifest_json")
    
    local status=$(echo "$response" | jq -r '.status // "unknown"')
    
    if [ "$status" = "success" ] || [ "$status" = "pending" ]; then
        echo -e "${GREEN}✓ Deploy request sent successfully!${NC}\n"
        echo -e "${YELLOW}Response:${NC}"
        echo "$response" | jq '.'
        echo ""
        echo -e "${CYAN}⏳ Waiting for pod to start (10 seconds)...${NC}"
        sleep 10
        
        # Check if pod is running and get URL
        if kubectl -n ${namespace} get pods 2>/dev/null | grep -q "Running"; then
            echo -e "${GREEN}✓ Pod is running!${NC}\n"
            
            # Get NodePort
            local nodeport=$(kubectl -n ${namespace} get svc -o jsonpath='{.items[0].spec.ports[0].nodePort}' 2>/dev/null)
            local server_ip=$(hostname -I | awk '{print $1}')
            
            if [ -n "$nodeport" ]; then
                echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${GREEN}🌐 LIVE SITE URLs:${NC}"
                echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${CYAN}   Local:  http://localhost:${nodeport}${NC}"
                echo -e "${CYAN}   Remote: http://${server_ip}:${nodeport}${NC}"
                echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
            fi
            
            kubectl -n ${namespace} get pods
            echo ""
        else
            echo -e "${YELLOW}⚠ Pod is still starting...${NC}"
            kubectl -n ${namespace} get pods
            echo ""
        fi
        
        echo -e "${CYAN}Next steps:${NC}"
        echo "  1. Check status:  $0 status ${workload_id}"
        echo "  2. Get URL:       ./get-url.sh ${workload_id}"
        echo "  3. View logs:     $0 logs ${namespace}"
    else
        echo -e "${RED}✗ Deploy failed${NC}\n"
        echo "$response" | jq '.'
        exit 1
    fi
}

check_status() {
    local workload_id="$1"
    
    if [ -z "$workload_id" ]; then
        echo -e "${RED}Error: Workload ID required${NC}"
        echo "Usage: $0 status <workload-id>"
        exit 1
    fi
    
    if ! check_server; then
        exit 1
    fi
    
    echo -e "${BLUE}Checking status for workload ${workload_id}...${NC}\n"
    
    local response=$(curl -s "${SERVER_URL}/status?workloadId=${workload_id}&instanceId=1")
    echo "$response" | jq '.'
}

check_health() {
    echo -e "${BLUE}Checking server health...${NC}\n"
    
    if check_server; then
        local response=$(curl -s "${SERVER_URL}/health")
        echo "$response" | jq '.'
        echo ""
        echo -e "${GREEN}✓ Server is healthy${NC}"
    else
        exit 1
    fi
}

view_logs() {
    local namespace="$1"
    
    if [ -z "$namespace" ]; then
        echo -e "${RED}Error: Namespace required${NC}"
        echo "Usage: $0 logs <namespace>"
        echo "Example: $0 logs workload-1-1"
        exit 1
    fi
    
    echo -e "${BLUE}Viewing logs for namespace: ${namespace}${NC}\n"
    
    # Get pods in namespace
    echo -e "${CYAN}Pods in namespace:${NC}"
    kubectl -n "$namespace" get pods
    
    echo ""
    echo -e "${CYAN}Logs (press Ctrl+C to stop):${NC}"
    kubectl -n "$namespace" logs -f --all-containers=true --tail=50
}

delete_workload() {
    local workload_id="$1"
    
    if [ -z "$workload_id" ]; then
        echo -e "${RED}Error: Workload ID required${NC}"
        echo "Usage: $0 delete <workload-id>"
        exit 1
    fi
    
    local namespace="workload-${workload_id}-1"
    
    echo -e "${YELLOW}Deleting workload ${workload_id} (namespace: ${namespace})...${NC}"
    
    if kubectl get namespace "$namespace" > /dev/null 2>&1; then
        kubectl delete namespace "$namespace"
        echo -e "${GREEN}✓ Workload deleted${NC}"
    else
        echo -e "${YELLOW}Namespace ${namespace} does not exist${NC}"
    fi
}

clean_all() {
    echo -e "${YELLOW}Cleaning all Cloudana workloads...${NC}\n"
    
    # Find all workload-* namespaces
    local namespaces=$(kubectl get namespaces -o name | grep 'namespace/workload-' | sed 's|namespace/||')
    
    if [ -z "$namespaces" ]; then
        echo -e "${CYAN}No workload namespaces found${NC}"
        return
    fi
    
    echo -e "${CYAN}Found workload namespaces:${NC}"
    echo "$namespaces"
    echo ""
    
    read -p "Delete all these namespaces? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for ns in $namespaces; do
            echo -e "${YELLOW}Deleting ${ns}...${NC}"
            kubectl delete namespace "$ns"
        done
        echo -e "${GREEN}✓ All workloads cleaned${NC}"
    else
        echo -e "${CYAN}Cancelled${NC}"
    fi
}

# Main command handler
main() {
    print_header
    
    case "${1:-}" in
        start)
            start_server
            ;;
        deploy)
            deploy_game "$2"
            ;;
        status)
            check_status "$2"
            ;;
        url)
            if [ -x "./get-url.sh" ]; then
                ./get-url.sh "$2"
            else
                echo -e "${RED}Error: get-url.sh not found${NC}"
                exit 1
            fi
            ;;
        list)
            list_games
            ;;
        health)
            check_health
            ;;
        logs)
            view_logs "$2"
            ;;
        delete)
            delete_workload "$2"
            ;;
        clean)
            clean_all
            ;;
        *)
            print_usage
            exit 1
            ;;
    esac
}

main "$@"
