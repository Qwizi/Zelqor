---
name: no_local_frontend_build
description: Frontend (Next.js) runs in Docker - use pnpm lint instead of pnpm build for verification
type: feedback
---

Do not run `pnpm build` for the frontend - it runs inside Docker. Use `pnpm lint` instead to verify frontend changes locally.

**Why:** The Next.js app is containerized and the build environment is Docker-based.
**How to apply:** After making frontend changes, run `pnpm lint` in the `frontend/` directory for verification instead of `pnpm build`.
