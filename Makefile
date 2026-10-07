# Makefile for managing the Okta Privileged Access (OPA) Utilities
-include .env
export

# Docker Compose profiles
PROFILE_PROD = --profile prod
PROFILE_DEV = --profile dev

.PHONY: help install dev start start-logs stop restart restart-logs logs build rebuild kill check-prereqs check-docker check-env validate-env clean
.PHONY: dev-start dev-start-logs dev-stop dev-restart dev-restart-logs dev-logs dev-build dev-rebuild dev-kill dev-check-prereqs dev-check-env

help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Local Development:"
	@echo "  install        - Install Node.js dependencies (npm install)."
	@echo "  dev            - Run application locally in development mode with nodemon."
	@echo "  clean          - Remove node_modules and package-lock.json."
	@echo ""
	@echo "Production (Docker):"
	@echo "  start          - Start production containers in the background."
	@echo "  start-logs     - Start production containers and follow logs."
	@echo "  start-live     - Start production containers in live mode (attached)."
	@echo "  stop           - Stop and remove production containers."
	@echo "  restart        - Restart production containers."
	@echo "  restart-logs   - Restart production containers and follow logs."
	@echo "  logs           - Follow production container logs."
	@echo "  build          - Build production Docker image."
	@echo "  rebuild        - Force rebuild production image from scratch."
	@echo "  kill           - Kill production containers and remove orphans."
	@echo ""
	@echo "Development (Docker):"
	@echo "  dev-start      - Start dev containers (mounts source code)."
	@echo "  dev-start-logs - Start dev containers and follow logs."
	@echo "  dev-stop       - Stop and remove dev containers."
	@echo "  dev-restart    - Restart dev containers."
	@echo "  dev-restart-logs - Restart dev containers and follow logs."
	@echo "  dev-logs       - Follow dev container logs."
	@echo "  dev-build      - Build development Docker image."
	@echo "  dev-rebuild    - Force rebuild dev image from scratch."
	@echo "  dev-kill       - Kill dev containers and remove orphans."
	@echo ""
	@echo "Utilities:"
	@echo "  check-prereqs  - Run prerequisite checks without starting services."
	@echo "  check-env      - Validate environment configuration."

install:
	@echo "--> Installing Node.js dependencies..."
	@npm install
	@echo "\033[0;32m[✔] Dependencies installed successfully\033[0m"

dev: check-env
	@echo "--> Starting application in development mode..."
	@npm run dev

clean:
	@echo "--> Cleaning up node_modules and package-lock.json..."
	@rm -rf node_modules package-lock.json
	@echo "\033[0;32m[✔] Cleanup complete\033[0m"

# =============================================================================
# Production (Docker) Commands
# =============================================================================

start: check-prereqs
	@echo "--> Starting production containers in detached mode..."
	@docker compose $(PROFILE_PROD) up -d

start-live: check-prereqs
	@echo "--> Starting production containers in live mode..."
	@docker compose $(PROFILE_PROD) up

stop:
	@echo "--> Stopping production containers..."
	@docker compose $(PROFILE_PROD) down

restart: stop start

logs:
	@echo "--> Tailing production logs..."
	@docker compose $(PROFILE_PROD) logs -f --tail=500

start-logs: check-prereqs
	@echo "--> Starting production containers and attaching logs..."
	@docker compose $(PROFILE_PROD) up -d
	@sleep 3
	@$(MAKE) logs

restart-logs: stop start-logs

rebuild: check-prereqs
	@echo "--> Forcing a rebuild of production image..."
	@docker compose $(PROFILE_PROD) build --no-cache --pull --force-rm

build: check-prereqs
	@echo "--> Building production image..."
	@docker compose $(PROFILE_PROD) build

kill:
	@echo "--> Killing production containers and removing orphans..."
	@docker compose $(PROFILE_PROD) kill --remove-orphans

# =============================================================================
# Development (Docker) Commands
# =============================================================================

dev-start: dev-check-prereqs
	@echo "--> Starting development containers (source code mounted)..."
	@docker compose $(PROFILE_DEV) up -d

dev-start-live: dev-check-prereqs
	@echo "--> Starting development containers in live mode..."
	@docker compose $(PROFILE_DEV) up

dev-stop:
	@echo "--> Stopping development containers..."
	@docker compose $(PROFILE_DEV) down

dev-restart: dev-stop dev-start

dev-logs:
	@echo "--> Tailing development logs..."
	@docker compose $(PROFILE_DEV) logs -f --tail=500

dev-start-logs: dev-check-prereqs
	@echo "--> Starting development containers and attaching logs..."
	@docker compose $(PROFILE_DEV) up -d
	@sleep 3
	@$(MAKE) dev-logs

dev-restart-logs: dev-stop dev-start-logs

dev-rebuild: dev-check-prereqs
	@echo "--> Forcing a rebuild of development image..."
	@docker compose $(PROFILE_DEV) build --no-cache --pull --force-rm

dev-build: dev-check-prereqs
	@echo "--> Building development image..."
	@docker compose $(PROFILE_DEV) build

dev-kill:
	@echo "--> Killing development containers and removing orphans..."
	@docker compose $(PROFILE_DEV) kill --remove-orphans

# =============================================================================
# Prerequisite Checks
# =============================================================================

check-prereqs: check-docker check-env
	@echo ""
	@echo "\033[0;32m[✔] All prerequisites check passed\033[0m"
	@echo ""

dev-check-prereqs: check-docker dev-check-env
	@echo ""
	@echo "\033[0;32m[✔] All development prerequisites check passed\033[0m"
	@echo ""


check-docker:
	@echo ""
	@echo "--> Checking Docker prerequisites..."
	@if ! docker info > /dev/null 2>&1; then \
		echo "\033[0;31m  [x] ERROR: Docker is not running, not installed, not in PATH or you don't have permissions to access it!\033[0m"; \
		exit 1; \
	else \
		echo "\033[0;32m  [✔] Docker is running and accessible\033[0m"; \
	fi
	@if ! command -v docker-compose &> /dev/null; then \
		if ! docker compose version &> /dev/null; then \
			echo "\033[0;31m  [x] ERROR: Docker Compose is not installed or not in PATH!\033[0m"; \
			exit 1; \
		else \
			echo "\033[0;32m  [✔] Docker Compose (v2) is installed\033[0m"; \
		fi; \
	else \
		echo "\033[0;32m  [✔] Docker Compose is installed\033[0m"; \
	fi

check-env:
	@echo ""
	@echo "--> Checking environment configuration..."
	@if [ ! -f .env ]; then \
		echo "\033[0;31m  [x] ERROR: .env file not found!\033[0m"; \
		echo "Please copy the sample environment file: cp .env.example .env"; \
		exit 1; \
	else \
		echo "\033[0;32m  [✔] .env file exists\033[0m"; \
	fi
	@$(MAKE) --no-print-directory validate-env ENV_FILE=.env

dev-check-env:
	@echo ""
	@echo "--> Checking environment configuration..."
	@if [ ! -f .env.development ]; then \
		echo "\033[0;31m  [x] ERROR: .env.development file not found!\033[0m"; \
		echo "Please copy the sample environment file: cp .env.development.example .env.development"; \
		exit 1; \
	else \
		echo "\033[0;32m  [✔] .env.development file exists\033[0m"; \
	fi
	@$(MAKE) --no-print-directory validate-env ENV_FILE=.env.development

# Validate environment variables based on deployment mode
validate-env:
	@. ./$(ENV_FILE) 2>/dev/null || true; \
	MULTITENANT_VAL=$$(grep -E "^MULTITENANT=" ./$(ENV_FILE) 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'" | tr '[:upper:]' '[:lower:]'); \
	echo "  Mode: $${MULTITENANT_VAL:-no} (MULTITENANT)"; \
	MISSING=""; \
	check_var() { \
		val=$$(grep -E "^$$1=" ./$(ENV_FILE) 2>/dev/null | cut -d'=' -f2); \
		if [ -z "$$val" ] || [ "$$val" = "your-"* ]; then \
			MISSING="$$MISSING $$1"; \
		fi; \
	}; \
	check_var BASE_URI; \
	check_var SESSION_SECRET; \
	if [ "$$MULTITENANT_VAL" = "yes" ] || [ "$$MULTITENANT_VAL" = "true" ] || [ "$$MULTITENANT_VAL" = "1" ]; then \
		echo "  Validating multi-tenant mode variables..."; \
		check_var PGHOST; \
		check_var PGDATABASE; \
		check_var PGUSER; \
		check_var PGPASSWORD; \
	else \
		echo "  Validating single-tenant mode variables..."; \
		check_var OKTA_ISSUER; \
		check_var OKTA_CLIENT_ID; \
		check_var OKTA_CLIENT_SECRET; \
		check_var AWS_ACCESS_KEY_ID; \
		check_var AWS_SECRET_ACCESS_KEY; \
		check_var AWS_REGION; \
		check_var AWS_S3_BUCKET; \
	fi; \
	if [ -n "$$MISSING" ]; then \
		echo "\033[0;33m  [!] WARNING: Missing or placeholder values for:$$MISSING\033[0m"; \
		echo "      Please update these in $(ENV_FILE)"; \
	else \
		echo "\033[0;32m  [✔] All required variables configured\033[0m"; \
	fi
