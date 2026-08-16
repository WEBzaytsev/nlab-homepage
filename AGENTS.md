# NLab Homepage agent rules

## Verification policy

- Do not create, restore, generate, or run automated tests in this repository.
- Do not add test runners, test frameworks, test-only dependencies, fixtures, snapshots, mocks, or coverage tooling.
- The required verification gates are exactly:
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- Do not report tests as missing or recommend adding them. Verify behavior through static analysis, lint, and production build only.

## Runtime architecture

- Keep the application on Next.js standalone with `node server.js`.
- Do not add Nginx or another web server to the application image.
- Do not embed the production directory YAML in the image.
- Runtime uses three operator-owned files mounted read-only at `/app/config`: required `global.yaml`, required `catalog.yaml`, and optional `projects.yaml`.
- Runtime uses no formatter sidecar; the application never rewrites mounted files.
- Preserve `HOMEPAGE_ALLOWED_HOSTS` validation.
- Authentication belongs at the Caddy/TinyAuth Forward Auth boundary; do not add a second login/session layer inside the application.

## Configuration

- Runtime YAML does not belong in this repository. Keep it in the deployment repository and mount it read-only at `/app/config`.
- Local `config/*.yaml` files are ignored and may be used only as operator-owned development data.
- `npm run check:config-format -- <paths...>` and `npm run validate:config -- <paths...>` require explicit runtime or development paths.
- `npm run dev`, `npm run lint`, and `npm run build` must not depend on private runtime data.

## Delivery

- Keep changes narrowly scoped and remove obsolete paths instead of retaining legacy fallbacks.
- Before committing, inspect the exact diff and run only the required verification gates listed above.
- Never commit secrets, credentials, runtime `.env` contents, or production-only state.