.PHONY: test test-backend test-frontend test-gateway test-e2e

## Run all tests (backend is skipped — requires running DB)
test: test-gateway test-frontend

## Rust gateway tests
test-gateway:
	cd gateway && cargo test

## Frontend unit tests (vitest)
test-frontend:
	cd frontend && pnpm test

## Django tests (requires running PostgreSQL+PostGIS)
test-backend:
	uv run python manage.py test

## Frontend E2E tests (Playwright, requires running stack)
test-e2e:
	cd frontend && pnpm test:e2e
