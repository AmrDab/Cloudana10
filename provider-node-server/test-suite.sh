#!/bin/bash
# Automated test suite for provider node with game manifests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTS_DIR="$SCRIPT_DIR/../game-manifests"
SERVER_PORT="${PROVIDER_NODE_PORT:-4040}"
SERVER_URL="http://localhost:${SERVER_PORT}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

print_test_header() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Test: $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
}

check_server() {
    if ! curl -s "${SERVER_URL}/health" > /dev/null 2>&1; then
        echo -e "${RED}✗ Server is not running on ${SERVER_URL}${NC}"
        echo -e "${YELLOW}  Please start the server first: ./test-local.sh start${NC}"
        exit 1
    fi
}

test_health() {
    print_test_header "Health Check"
    
    local response=$(curl -s "${SERVER_URL}/health")
    local status=$(echo "$response" | jq -r '.status // "unknown"')
    
    if [ "$status" = "healthy" ]; then
        echo -e "${GREEN}✓ Server health check passed${NC}"
        echo "$response" | jq '.'
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ Server health check failed${NC}"
        echo "$response" | jq '.'
        ((TESTS_FAILED++))
    fi
}

test_device_info() {
    print_test_header "Device Info"
    
    local response=$(curl -s "${SERVER_URL}/device-info")
    local device_id=$(echo "$response" | jq -r '.deviceId // "unknown"')
    
    if [ "$device_id" != "unknown" ] && [ "$device_id" != "null" ]; then
        echo -e "${GREEN}✓ Device info retrieved${NC}"
        echo "$response" | jq '.'
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ Device info failed${NC}"
        echo "$response" | jq '.'
        ((TESTS_FAILED++))
    fi
}

test_deploy_manifest() {
    local game_name="$1"
    local workload_id="$2"
    
    print_test_header "Deploy: ${game_name}"
    
    local manifest_file="${MANIFESTS_DIR}/${game_name}.json"
    
    if [ ! -f "$manifest_file" ]; then
        echo -e "${RED}✗ Manifest file not found: ${manifest_file}${NC}"
        ((TESTS_FAILED++))
        return
    fi
    
    echo -e "${CYAN}Deploying manifest: ${manifest_file}${NC}"
    
    local manifest_json=$(cat "$manifest_file")
    local response=$(curl -s -X POST "${SERVER_URL}/deploy" \
        -H "Content-Type: application/json" \
        -d "$manifest_json")
    
    local status=$(echo "$response" | jq -r '.status // "unknown"')
    
    if [ "$status" = "success" ] || [ "$status" = "pending" ]; then
        echo -e "${GREEN}✓ Deploy request accepted${NC}"
        echo "$response" | jq '.'
        ((TESTS_PASSED++))
        
        # Wait a bit for deployment to start
        echo -e "${CYAN}Waiting 5 seconds for deployment to initialize...${NC}"
        sleep 5
        
        # Check status
        test_status "$workload_id"
    else
        echo -e "${RED}✗ Deploy failed${NC}"
        echo "$response" | jq '.'
        ((TESTS_FAILED++))
    fi
}

test_status() {
    local workload_id="$1"
    
    print_test_header "Status Check: Workload ${workload_id}"
    
    local response=$(curl -s "${SERVER_URL}/status?workloadId=${workload_id}&instanceId=1")
    local status=$(echo "$response" | jq -r '.status // "unknown"')
    
    echo -e "${CYAN}Status: ${status}${NC}"
    echo "$response" | jq '.'
    
    if [ "$status" != "unknown" ] && [ "$status" != "null" ]; then
        echo -e "${GREEN}✓ Status retrieved${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${YELLOW}⚠ Status check inconclusive${NC}"
    fi
}

test_k8s_resources() {
    local namespace="$1"
    
    print_test_header "Kubernetes Resources: ${namespace}"
    
    if ! kubectl get namespace "$namespace" > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠ Namespace ${namespace} not found${NC}"
        return
    fi
    
    echo -e "${CYAN}Pods:${NC}"
    kubectl -n "$namespace" get pods
    
    echo ""
    echo -e "${CYAN}Services:${NC}"
    kubectl -n "$namespace" get svc
    
    echo ""
    echo -e "${CYAN}Deployments:${NC}"
    kubectl -n "$namespace" get deployments
    
    echo -e "${GREEN}✓ Kubernetes resources listed${NC}"
    ((TESTS_PASSED++))
}

cleanup_workload() {
    local namespace="$1"
    
    echo -e "${YELLOW}Cleaning up namespace: ${namespace}${NC}"
    
    if kubectl get namespace "$namespace" > /dev/null 2>&1; then
        kubectl delete namespace "$namespace" --timeout=60s
        echo -e "${GREEN}✓ Namespace deleted${NC}"
    fi
}

run_basic_tests() {
    echo -e "${BLUE}Running basic API tests...${NC}"
    
    test_health
    test_device_info
}

run_deployment_test() {
    local game="$1"
    local workload_id="$2"
    local namespace="workload-${workload_id}-1"
    
    echo -e "${BLUE}Running deployment test for ${game}...${NC}"
    
    # Clean up if exists
    cleanup_workload "$namespace" 2>/dev/null || true
    
    # Deploy
    test_deploy_manifest "$game" "$workload_id"
    
    # Wait a bit more for pod creation
    echo -e "${CYAN}Waiting 10 seconds for pod creation...${NC}"
    sleep 10
    
    # Check K8s resources
    test_k8s_resources "$namespace"
    
    # Ask if user wants to keep it deployed
    echo ""
    read -p "Keep ${game} deployed? (y/N) " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        cleanup_workload "$namespace"
    fi
}

run_full_suite() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║    Cloudana Provider Node - Full Test Suite          ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
    
    run_basic_tests
    
    echo ""
    read -p "Run deployment tests? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Test one simple game
        run_deployment_test "minesweeper" "4"
    fi
    
    # Print summary
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Test Summary${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}Passed: ${TESTS_PASSED}${NC}"
    echo -e "${RED}Failed: ${TESTS_FAILED}${NC}"
    echo ""
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}✓ All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Main
main() {
    check_server
    
    case "${1:-full}" in
        basic)
            run_basic_tests
            ;;
        deploy)
            if [ -z "$2" ] || [ -z "$3" ]; then
                echo "Usage: $0 deploy <game-name> <workload-id>"
                exit 1
            fi
            run_deployment_test "$2" "$3"
            ;;
        full)
            run_full_suite
            ;;
        *)
            echo "Usage: $0 [basic|deploy|full]"
            exit 1
            ;;
    esac
    
    # Print final summary
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}Tests Passed: ${TESTS_PASSED}${NC}"
    echo -e "${RED}Tests Failed: ${TESTS_FAILED}${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
}

main "$@"
