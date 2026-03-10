#!/bin/bash
# Cloudana MVP - System Status Checker
# Verifies all components are properly configured and running

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║     Cloudana MVP - System Status Check                      ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

PASS=0
WARN=0
FAIL=0

check() {
    local name="$1"
    local command="$2"
    
    printf "%-50s " "$name"
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAIL++))
        return 1
    fi
}

check_with_output() {
    local name="$1"
    local command="$2"
    
    printf "%-50s " "$name"
    
    local output=$(eval "$command" 2>&1)
    local status=$?
    
    if [ $status -eq 0 ]; then
        echo -e "${GREEN}✓ ${output}${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${RED}✗ ${output}${NC}"
        ((FAIL++))
        return 1
    fi
}

warn_check() {
    local name="$1"
    local command="$2"
    
    printf "%-50s " "$name"
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${YELLOW}⚠ WARN${NC}"
        ((WARN++))
        return 1
    fi
}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}System Requirements${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check "Node.js installed" "command -v node"
check "npm installed" "command -v npm"
check_with_output "Node.js version" "node --version"
warn_check "kubectl installed" "command -v kubectl"
warn_check "Kubernetes accessible" "kubectl cluster-info"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Provider Node Server${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check "Provider server directory exists" "test -d /opt/cloudana-mvp/provider-node-server"
check "Provider package.json exists" "test -f /opt/cloudana-mvp/provider-node-server/package.json"
check "Provider dependencies installed" "test -d /opt/cloudana-mvp/provider-node-server/node_modules"
check "Provider .env file exists" "test -f /opt/cloudana-mvp/provider-node-server/.env"

# Check if provider is running
if pgrep -f "provider-node-server" > /dev/null; then
    check "Provider node process running" "true"
else
    warn_check "Provider node process running" "false"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Orchestrator (API Server)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check "Orchestrator directory exists" "test -d /opt/cloudana-mvp/client/api"
check "Orchestrator package.json exists" "test -f /opt/cloudana-mvp/client/api/package.json"
check "Orchestrator dependencies installed" "test -d /opt/cloudana-mvp/client/api/node_modules"
warn_check "Orchestrator .env file exists" "test -f /opt/cloudana-mvp/client/api/.env"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Smart Contract${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check "Contract directory exists" "test -d /opt/cloudana-mvp/contract"
check "Contract package.json exists" "test -f /opt/cloudana-mvp/contract/package.json"
warn_check "Contract dependencies installed" "test -d /opt/cloudana-mvp/contract/node_modules"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Integration & Documentation${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check "URL system implemented (k8s-client.ts)" "grep -q 'services.*urls' /opt/cloudana-mvp/provider-node-server/src/k8s-client.ts"
check "Orchestrator extracts URLs" "grep -q 'urls' /opt/cloudana-mvp/client/api/src/services/workload-status-poller.service.ts"
check "API exposes URLs" "grep -q 'urls' /opt/cloudana-mvp/client/api/src/routes/v1/workload-status.ts"
check "Installation script exists" "test -f /opt/cloudana-mvp/provider-node-server/install-provider.sh"
check "Production deployment guide exists" "test -f /opt/cloudana-mvp/PRODUCTION-DEPLOYMENT.md"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Testing Infrastructure${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check "test-local.sh exists" "test -f /opt/cloudana-mvp/provider-node-server/test-local.sh"
check "get-url.sh exists" "test -f /opt/cloudana-mvp/provider-node-server/get-url.sh"
check "test-suite.sh exists" "test -f /opt/cloudana-mvp/provider-node-server/test-suite.sh"
check "Game manifests exist" "test -d /opt/cloudana-mvp/game-manifests"
check "Game manifest count" "test $(ls /opt/cloudana-mvp/game-manifests/*.json 2>/dev/null | wc -l) -ge 6"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Documentation${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

check "WORKLOAD-URLS.md" "test -f /opt/cloudana-mvp/provider-node-server/WORKLOAD-URLS.md"
check "INTEGRATION-COMPLETE.md" "test -f /opt/cloudana-mvp/INTEGRATION-COMPLETE.md"
check "PRODUCTION-DEPLOYMENT.md" "test -f /opt/cloudana-mvp/PRODUCTION-DEPLOYMENT.md"
check "LOCAL-TESTING.md" "test -f /opt/cloudana-mvp/provider-node-server/LOCAL-TESTING.md"
check "QUICK-REFERENCE.md" "test -f /opt/cloudana-mvp/QUICK-REFERENCE.md"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Live Deployments (if any)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if command -v kubectl &> /dev/null && kubectl cluster-info &> /dev/null; then
    WORKLOAD_COUNT=$(kubectl get ns 2>/dev/null | grep -c "^workload-" || echo "0")
    if [ "$WORKLOAD_COUNT" -gt 0 ]; then
        echo -e "${GREEN}Found $WORKLOAD_COUNT deployed workload(s):${NC}"
        kubectl get pods -A 2>/dev/null | grep "workload-" | head -10
    else
        echo -e "${CYAN}No workloads currently deployed${NC}"
    fi
else
    echo -e "${YELLOW}Kubernetes not accessible - cannot check workloads${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TOTAL=$((PASS + WARN + FAIL))
echo ""
echo -e "${GREEN}✓ Passed:  ${PASS}${NC}"
echo -e "${YELLOW}⚠ Warnings: ${WARN}${NC}"
echo -e "${RED}✗ Failed:  ${FAIL}${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Total:    ${TOTAL}${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    if [ $WARN -eq 0 ]; then
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                                                              ║${NC}"
        echo -e "${GREEN}║     ✅ All checks passed! System is ready!                    ║${NC}"
        echo -e "${GREEN}║                                                              ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    else
        echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${YELLOW}║                                                              ║${NC}"
        echo -e "${YELLOW}║     ⚠ System ready with warnings                             ║${NC}"
        echo -e "${YELLOW}║                                                              ║${NC}"
        echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    fi
    
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo "1. Read: PRODUCTION-DEPLOYMENT.md"
    echo "2. Configure: provider-node-server/.env (set PUBLIC_HOSTNAME)"
    echo "3. Deploy: Follow production deployment guide"
    echo "4. Test: Run ./test-local.sh to verify provider node"
    echo ""
    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}║     ✗ Some checks failed - review and fix                    ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi
