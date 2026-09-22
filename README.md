# Prism Gateway — Phase-0 Compatibility Lab

Offline, executable lab for the Prism Gateway plan. No network calls, no
credentials, no production behavior, no deployment. See
`config/promotion-contract.md` for the dev/prod discipline.

## Commands (clean checkout)

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm test            # build + node --test dist/tests/*.test.js
npm run bill        # reproducible platform-bill scenarios (synthetic inputs)
npm run bill -- 3   # single scale: 1, 3, or 10
```

Note: install with dev dependencies included (`NODE_ENV=development`
if your environment defaults to production).

## What the lab proves

- One synthetic HTTP/SSE exchange parses end-to-end through a bounded
  incremental parser (split chunks, byte-at-a-time, `[DONE]` termination,
  oversized-field rejection).
- Gateway/admin/session deny inference and management by default in both
  `dev` and `prod`.
- The versioned manifest (`src/evidence/manifest.ts`) names all eight
  mandatory providers as explicitly unproven, with visible dialect/parity
  gates. Tests reject any `supported` row lacking deployed proof.
- A generic full-bill calculator (`src/billing/`) prices every Cloudflare
  meter (Workers, DO requests/duration/SQLite, Queues, D1, R2, logging,
  domain, tax) at 1x/3x/10x on pinned synthetic inputs. Unknown inputs
  throw instead of defaulting to zero; upstream inference is excluded.

## Non-goals

Live provider inference, OAuth flows, Cloudflare deployment, paid
resources, traffic cutover, or production deployment. An offline
fixture is never a deployed-Worker proof.

## License

MIT — see [LICENSE](LICENSE).
