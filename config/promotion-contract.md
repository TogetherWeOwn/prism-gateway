# Promotion / migration contract (Phase 0, from the first commit)

Dev and prod are separate named configurations (`dev`, `prod`) with no
shared secrets or resource IDs. Placeholder bindings only — no real
Cloudflare resources exist in this slice.

## Promotion rule

1. A config version is published to **dev** first.
2. Fixture tests plus the synthetic exchange test must pass on that version.
3. The **same version hash** is promoted to **prod** via compare-and-set
   activation. Skipping dev, editing prod in place, or promoting an
   untested hash is a contract violation.
4. Rollback means reactivating the prior version hash, never mutating history.

## Migration rule

- Storage migrations are backwards-compatible: the previous schema
  remains readable after deploy. No destructive migration exists in Phase 0.

## Out of scope for this slice

No prod deployment, production credential transfer, live provider
inference, OAuth rotation, paid-resource creation, or
traffic cutover. An offline fixture is lab evidence only — it is never a
deployed-Worker proof.
