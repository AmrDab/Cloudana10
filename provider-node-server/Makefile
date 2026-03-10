.PHONY: help install dev start test-list test-health test-suite deploy-% status-% delete-% clean logs-% k8s-%

# Default target
help:
	@echo "╔════════════════════════════════════════════════════════╗"
	@echo "║  Cloudana Provider Node - Local Testing Commands      ║"
	@echo "╚════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "Setup:"
	@echo "  make install        Install dependencies"
	@echo ""
	@echo "Server:"
	@echo "  make dev           Start server in dev mode"
	@echo "  make start         Start server in production mode"
	@echo ""
	@echo "Testing:"
	@echo "  make test-list     List available games"
	@echo "  make test-health   Check server health"
	@echo "  make test-suite    Run automated test suite"
	@echo ""
	@echo "Deploy Games:"
	@echo "  make deploy-supermario"
	@echo "  make deploy-tetris"
	@echo "  make deploy-pacman"
	@echo "  make deploy-minesweeper"
	@echo "  make deploy-memory-game"
	@echo "  make deploy-snake-game"
	@echo ""
	@echo "Status & Logs:"
	@echo "  make status-1      Check status of workload 1"
	@echo "  make logs-1        View logs for workload 1"
	@echo ""
	@echo "Cleanup:"
	@echo "  make delete-1      Delete workload 1"
	@echo "  make clean         Delete all workloads"
	@echo ""
	@echo "Kubernetes:"
	@echo "  make k8s-workload-1-1   Show K8s resources for workload-1-1"
	@echo ""

install:
	@echo "📦 Installing dependencies..."
	npm install

dev:
	@echo "🚀 Starting server in development mode..."
	npm run dev

start:
	@echo "🚀 Starting server..."
	npm start

# Testing commands
test-list:
	@./test-local.sh list

test-health:
	@./test-local.sh health

test-suite:
	@./test-suite.sh full

test-suite-basic:
	@./test-suite.sh basic

# Deploy specific games
deploy-supermario:
	@./test-local.sh deploy supermario

deploy-tetris:
	@./test-local.sh deploy tetris

deploy-pacman:
	@./test-local.sh deploy pacman

deploy-minesweeper:
	@./test-local.sh deploy minesweeper

deploy-memory-game:
	@./test-local.sh deploy memory-game

deploy-snake-game:
	@./test-local.sh deploy snake-game

# Status checks (usage: make status-1)
status-%:
	@./test-local.sh status $*

# View logs (usage: make logs-1)
logs-%:
	@./test-local.sh logs workload-$*-1

# Delete workload (usage: make delete-1)
delete-%:
	@./test-local.sh delete $*

# Clean all workloads
clean:
	@./test-local.sh clean

# Kubernetes helpers (usage: make k8s-workload-1-1)
k8s-%:
	@echo "📋 Kubernetes resources for $*:"
	@echo ""
	@echo "Pods:"
	@kubectl -n $* get pods
	@echo ""
	@echo "Services:"
	@kubectl -n $* get svc
	@echo ""
	@echo "Deployments:"
	@kubectl -n $* get deployments

# Quick deploy and watch
quick-test:
	@echo "🎮 Quick test: deploying minesweeper..."
	@./test-local.sh deploy minesweeper
	@echo ""
	@echo "⏳ Waiting for pod..."
	@sleep 5
	@kubectl -n workload-4-1 get pods
	@echo ""
	@echo "🎯 Service info:"
	@kubectl -n workload-4-1 get svc

# Development helpers
watch-workload-%:
	@watch -n 2 kubectl -n workload-$*-1 get pods

port-forward-%:
	@echo "🌐 Port forwarding workload-$*-1 to localhost:8080"
	@kubectl -n workload-$*-1 port-forward svc/$$(kubectl -n workload-$*-1 get svc -o jsonpath='{.items[0].metadata.name}') 8080:80
