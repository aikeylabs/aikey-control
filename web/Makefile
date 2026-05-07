.PHONY: dev stop restart build lint

PID_FILE := .vite.pid

# Start dev server in background, record PID
dev:
	@$(MAKE) stop
	@npm run dev & echo $$! > $(PID_FILE)
	@echo "Dev server started (pid=$$(cat $(PID_FILE))): http://localhost:3000"

# Kill the dev server started by this Makefile
stop:
	@if [ -f $(PID_FILE) ]; then \
		PID=$$(cat $(PID_FILE)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill $$PID && echo "Stopped dev server (pid=$$PID)"; \
		fi; \
		rm -f $(PID_FILE); \
	fi
	@# Also kill any stray vite processes bound to port 5173
	@lsof -ti tcp:3000 | xargs -r kill -9 2>/dev/null || true

# Kill existing server, then restart
restart:
	@$(MAKE) stop
	@$(MAKE) dev

# Production build
build:
	npm run build

# Type-check + lint
lint:
	npm run lint
	npx tsc --noEmit
