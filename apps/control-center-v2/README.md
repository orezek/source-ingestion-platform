# control-center-v2

Mobile-first Next.js operator UI for `control-service-v2`.

## Stack

- Next.js App Router
- Tailwind CSS
- shadcn/ui-style component primitives
- `react-hook-form` + `zod`

## Runtime Contract

- initial page loads use a server-only backend client against `control-service`
- browser-side mutations use same-origin Next.js Route Handlers
- live updates use a same-origin SSE proxy route
- the browser must not hold `CONTROL_SHARED_TOKEN`
- V2 assumes trusted internal access enforced outside the app

## Env

See [`.env.example`](./.env.example).

Required:

- `CONTROL_SERVICE_BASE_URL`
- `CONTROL_SHARED_TOKEN`

Deployment rules:

- set both envs as server-side secrets only
- do not expose either value via `NEXT_PUBLIC_*`
- for Vercel, add both variables to the project environment and keep them available only to
  server execution paths
- `CONTROL_SERVICE_BASE_URL` should point at the deployed `control-service-v2` base URL
- `CONTROL_SHARED_TOKEN` must match the token accepted by `control-service-v2`

## Development

```bash
pnpm install
pnpm -C apps/control-center-v2 dev
```

## Validation

```bash
pnpm -C apps/control-center-v2 lint
pnpm -C apps/control-center-v2 check-types
pnpm -C apps/control-center-v2 build
pnpm -C apps/control-center-v2 test
pnpm -C apps/control-center-v2 test:e2e
```

E2E notes:

- Playwright scenarios live in [`tests/e2e`](./tests/e2e).
- Create-form e2e tests run in headed mode and mock `POST /api/pipelines`.
