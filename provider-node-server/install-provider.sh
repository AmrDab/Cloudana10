#!/bin/bash
# Provider Node Installation Script
# Installs and configures provider-node-server on a provider's machine

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║     Cloudana Provider Node - Installation Script            ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect OS
OS="$(uname -s)"
echo -e "${BLUE}Detected OS: ${OS}${NC}"

# Check requirements
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1/7: Checking requirements...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    echo -e "${YELLOW}  Please install Node.js 18+ from https://nodejs.org/${NC}"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js: ${NODE_VERSION}${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓ npm: ${NPM_VERSION}${NC}"

# Check kubectl
if ! command -v kubectl &> /dev/null; then
    echo -e "${YELLOW}⚠ kubectl not found${NC}"
    echo -e "${YELLOW}  Install kubectl if you want to run Kubernetes workloads${NC}"
    echo -e "${YELLOW}  See: https://kubernetes.io/docs/tasks/tools/${NC}"
else
    KUBECTL_VERSION=$(kubectl version --client --short 2>/dev/null | head -1)
    echo -e "${GREEN}✓ kubectl: ${KUBECTL_VERSION}${NC}"
fi

# Check Kubernetes access
if command -v kubectl &> /dev/null; then
    if kubectl cluster-info &> /dev/null; then
        echo -e "${GREEN}✓ Kubernetes cluster accessible${NC}"
        KUBE_CONTEXT=$(kubectl config current-context)
        echo -e "${GREEN}  Context: ${KUBE_CONTEXT}${NC}"
    else
        echo -e "${YELLOW}⚠ Kubernetes cluster not accessible${NC}"
        echo -e "${YELLOW}  Configure kubectl if you want to run K8s workloads${NC}"
    fi
fi

# Get installation directory
INSTALL_DIR="${PROVIDER_NODE_INSTALL_DIR:-/opt/cloudana/provider-node}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2/7: Installation directory${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Install location: ${INSTALL_DIR}${NC}"

# Ask for confirmation
read -p "Continue with this location? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ ! $REPLY =~ ^$ ]]; then
    echo "Installation cancelled"
    exit 0
fi

# Create installation directory
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 3/7: Creating installation directory${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

sudo mkdir -p "$INSTALL_DIR"
sudo chown -R $USER:$USER "$INSTALL_DIR"
echo -e "${GREEN}✓ Directory created: ${INSTALL_DIR}${NC}"

# Copy provider-node-server files
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 4/7: Copying provider node files${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"
echo -e "${GREEN}✓ Files copied${NC}"

# Install dependencies
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 5/7: Installing dependencies${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

cd "$INSTALL_DIR"
npm install --production
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Configure environment
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 6/7: Configuration${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ ! -f "$INSTALL_DIR/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    echo -e "${GREEN}✓ Created .env file from template${NC}"
fi

# Detect public IP
echo ""
echo -e "${YELLOW}Detecting public IP address...${NC}"
PUBLIC_IP=$(curl -s -4 ifconfig.me 2>/dev/null || curl -s -4 icanhazip.com 2>/dev/null || echo "")

if [ -n "$PUBLIC_IP" ]; then
    echo -e "${GREEN}Detected public IP: ${PUBLIC_IP}${NC}"
    echo -e "${CYAN}This will be used to generate workload URLs${NC}"
    
    # Add to .env if not already set
    if ! grep -q "^PUBLIC_HOSTNAME=" "$INSTALL_DIR/.env"; then
        echo "PUBLIC_HOSTNAME=${PUBLIC_IP}" >> "$INSTALL_DIR/.env"
        echo -e "${GREEN}✓ Added PUBLIC_HOSTNAME to .env${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Could not detect public IP${NC}"
    echo -e "${YELLOW}  You should manually set PUBLIC_HOSTNAME in .env${NC}"
fi

echo ""
echo -e "${CYAN}Configuration file: ${INSTALL_DIR}/.env${NC}"
echo -e "${CYAN}You can edit this file to customize settings${NC}"

# Setup systemd service
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 7/7: Setting up systemd service${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

cat > /tmp/cloudana-provider-node.service <<EOF
[Unit]
Description=Cloudana Provider Node
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
Environment="NODE_ENV=production"
ExecStart=$(which node) $(which npm) start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cloudana-provider

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/cloudana-provider-node.service /etc/systemd/system/cloudana-provider-node.service
sudo systemctl daemon-reload
echo -e "${GREEN}✓ Systemd service created${NC}"

# Summary
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║     ✅ Installation Complete!                                 ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Installation directory: ${INSTALL_DIR}${NC}"
echo -e "${CYAN}Configuration file: ${INSTALL_DIR}/.env${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo -e "${CYAN}1. Review configuration:${NC}"
echo "   nano ${INSTALL_DIR}/.env"
echo ""
echo -e "${CYAN}2. Start the provider node:${NC}"
echo "   sudo systemctl start cloudana-provider-node"
echo ""
echo -e "${CYAN}3. Enable auto-start on boot:${NC}"
echo "   sudo systemctl enable cloudana-provider-node"
echo ""
echo -e "${CYAN}4. Check status:${NC}"
echo "   sudo systemctl status cloudana-provider-node"
echo ""
echo -e "${CYAN}5. View logs:${NC}"
echo "   sudo journalctl -u cloudana-provider-node -f"
echo ""
echo -e "${YELLOW}Important:${NC}"
echo -e "${CYAN}• Set PUBLIC_HOSTNAME in .env to your server's public IP/domain${NC}"
echo -e "${CYAN}• Configure firewall to allow ports 4040 and 30000-32767${NC}"
echo -e "${CYAN}• Ensure Kubernetes is running and kubectl is configured${NC}"
echo ""
echo -e "${GREEN}Ready to accept workloads from the Cloudana orchestrator! 🚀${NC}"
echo ""
