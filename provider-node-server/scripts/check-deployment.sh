#!/bin/bash
# Quick deployment check script
# Validates provider node is correctly configured

set -e

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Cloudana Provider Node - Deployment Check"
echo "═══════════════════════════════════════════════════════════════"
echo ""

ERRORS=0
WARNINGS=0

# Check 1: Not in Kubernetes
echo "Check 1: External Deployment"
if [ -n "$KUBERNETES_SERVICE_HOST" ]; then
    echo "  ✗ FAIL: KUBERNETES_SERVICE_HOST detected ($KUBERNETES_SERVICE_HOST)"
    echo "    Provider must run OUTSIDE Kubernetes!"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✓ PASS: External mode (no K8s in-cluster vars)"
fi

# Check 2: kubectl installed
echo ""
echo "Check 2: kubectl"
if command -v kubectl &> /dev/null; then
    VERSION=$(kubectl version --client -o json 2>/dev/null | grep -o '"gitVersion":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    echo "  ✓ PASS: kubectl installed ($VERSION)"
else
    echo "  ✗ FAIL: kubectl not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 3: kubeconfig
echo ""
echo "Check 3: Kubeconfig"
KUBECONFIG_PATH=${KUBECONFIG:-$HOME/.kube/config}
if [ -f "$KUBECONFIG_PATH" ]; then
    echo "  ✓ PASS: Kubeconfig exists at $KUBECONFIG_PATH"
else
    echo "  ✗ FAIL: Kubeconfig not found at $KUBECONFIG_PATH"
    ERRORS=$((ERRORS + 1))
fi

# Check 4: kubectl access
echo ""
echo "Check 4: Cluster Access"
if command -v kubectl &> /dev/null && kubectl get nodes &> /dev/null; then
    CONTEXT=$(kubectl config current-context)
    NODE_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | wc -l)
    echo "  ✓ PASS: Can access cluster"
    echo "    Context: $CONTEXT"
    echo "    Nodes: $NODE_COUNT"
else
    echo "  ⚠  Warning: Cannot access cluster"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 5: Node.js version
echo ""
echo "Check 5: Node.js Version"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR" -ge 18 ]; then
        echo "  ✓ PASS: Node.js $NODE_VERSION (>= 18)"
    else
        echo "  ✗ FAIL: Node.js $NODE_VERSION (< 18)"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "  ✗ FAIL: Node.js not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 6: Dependencies installed
echo ""
echo "Check 6: Dependencies"
if [ -d "node_modules" ]; then
    echo "  ✓ PASS: node_modules exists"
else
    echo "  ⚠  Warning: node_modules not found (run: npm install)"
    WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Summary"
echo "═══════════════════════════════════════════════════════════════"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "  ✓ ALL CHECKS PASSED"
    echo ""
    echo "  Ready to start:"
    echo "    npm run dev        # Development"
    echo "    npm start          # Production"
    echo "    npm run start:pm2  # Production with PM2"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "  ⚠  $WARNINGS warning(s) - provider can start"
    echo "    Review warnings above"
    echo ""
    exit 0
else
    echo "  ✗ $ERRORS error(s), $WARNINGS warning(s)"
    echo "    Fix errors before starting provider"
    echo ""
    exit 1
fi
