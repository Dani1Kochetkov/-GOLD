# RAGE:MP server — common operations.
#
# Everything is a thin wrapper around docker compose so that nobody has to
# remember the exact flags during a 3 AM incident.

SHELL := /bin/bash
COMPOSE ?= docker compose
PROJECT_DIR := $(CURDIR)

.DEFAULT_GOAL := help
.PHONY: help init build up down restart stop logs ps conf shell backup restore update db admin status lint

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

init: ## Create .env from .env.example if it is missing
	@if [ -f .env ]; then echo ".env already exists"; else cp .env.example .env; echo ".env created — edit it before going live"; fi
	@mkdir -p server-data/packages server-data/client_packages server-data/maps server-data/plugins backups

build: ## Build the server image (downloads server files from the CDN)
	$(COMPOSE) build

up: ## Start the server in the background
	@test -f .env || $(MAKE) init
	$(COMPOSE) up -d --build

down: ## Stop and remove containers (data in ./server-data is kept)
	$(COMPOSE) down

restart: ## Restart the server (use after editing .env)
	$(COMPOSE) up -d
	$(COMPOSE) restart ragemp

stop: ## Stop the server without removing the container
	$(COMPOSE) stop

logs: ## Follow server logs
	$(COMPOSE) logs -f --tail=200 ragemp

ps: ## Show container state and health
	$(COMPOSE) ps

conf: ## Print the conf.json that would be generated from .env
	$(COMPOSE) run --rm --no-deps ragemp --print-conf

shell: ## Open a shell inside the server container
	$(COMPOSE) run --rm --no-deps ragemp --shell

backup: ## Archive server-data and dump the database into ./backups
	./scripts/backup.sh

restore: ## Restore from an archive: make restore FILE=backups/ragemp-....tar.gz
	@test -n "$(FILE)" || { echo "usage: make restore FILE=backups/ragemp-....tar.gz"; exit 1; }
	./scripts/restore.sh "$(FILE)"

update: ## Pull fresh RAGE:MP server binaries and restart
	./scripts/update.sh

db: ## Start the server together with MariaDB
	$(COMPOSE) --profile db up -d --build

admin: ## Start MariaDB + Adminer (127.0.0.1:8080, use an SSH tunnel)
	$(COMPOSE) --profile db --profile admin up -d

status: ## Health check: containers, ports, disk, recent errors
	./scripts/status.sh

lint: ## Validate shell scripts, JSON and generated config
	@sh -n entrypoint.sh && echo "entrypoint.sh: ok"
	@for f in scripts/*.sh; do sh -n "$$f" && echo "$$f: ok"; done
	@jq empty config/conf.defaults.json && echo "conf.defaults.json: ok"
	@RAGE_ENV_FILE=/dev/null ./scripts/gen-conf.sh | jq empty && echo "conf.jq: ok"
