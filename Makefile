.PHONY: test test-backend test-frontend test-gateway test-gateway-unit test-gateway-integration test-gateway-coverage test-e2e

## Run all tests (unit only — no external services needed)
test: test-backend test-gateway-unit test-frontend

## All gateway tests (unit + integration, requires Redis on localhost:6379)
test-gateway: test-gateway-unit test-gateway-integration

## Gateway unit tests only (no Redis needed)
test-gateway-unit:
	cd gateway && cargo test

## Gateway integration tests (requires Redis: docker run -d -p 6379:6379 redis:7-alpine)
test-gateway-integration:
	cd gateway && REDIS_URL=redis://127.0.0.1:6379/15 cargo test --features maplord-matchmaking/testing -- --include-ignored

## Gateway test coverage report (requires Redis + cargo-tarpaulin)
test-gateway-coverage:
	cd gateway && REDIS_URL=redis://127.0.0.1:6379/15 cargo tarpaulin --workspace --exclude maplord-gateway --skip-clean --timeout 300 --features maplord-matchmaking/testing -- --include-ignored

## Frontend unit tests (vitest)
test-frontend:
	cd frontend && pnpm test

## Django tests (SQLite in-memory via pytest, no external DB needed)
test-backend:
	uv run pytest apps/

## Frontend E2E tests (Playwright, requires running stack)
test-e2e:
	cd frontend && pnpm test:e2e
