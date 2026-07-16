# Phase 5B isolated Preview verification

## Scope and identity

- Draft PR: #7
- implementation commit: `3017bb5caca51be96c8523c3e1062c343daebbff`
- isolated Vercel deployment: `dpl_76dMLT6vjRHm8fV64eLPwtZQoaqb`
- isolated Supabase project ref: `krlhwwjkgoqzusehxuav`
- installed migration count: 17
- current Storage migration: `20260716141423_harden_storage_image_lifecycle.sql`
- production and customer projects: not used

The first Preview environment check found that its public Supabase URL and server credential did not belong to the same isolated project. Testing stopped before business writes. Branch-only credentials were corrected, a fresh deployment was created, and acceptance resumed only after product runtime health and project identity matched.

## Business acceptance

All 9 scenarios passed:

1. isolated runtime and Storage security metadata were ready;
2. a developer session used a strict Cookie and could upload and replace a Logo;
3. an owner could upload, while anonymous, staff, inventory, and readonly identities could not write;
4. valid JPEG, PNG, and WebP inputs were decoded and re-encoded to dimensioned public WebP objects;
5. forged MIME, invalid dimensions, oversized payloads, and malformed files were rejected without object residue;
6. replacing an image removed the previous managed object;
7. main and gallery deletion removed database references before managed objects;
8. category images enforced the target contract and owner permission;
9. permanent deletion removed a safe product and object, while a product with inventory history was protected.

The public storefront read the isolated published product without exposing private procurement fields.

## Browser acceptance

The storefront and admin entry were checked at 390px, 768px, and 1440px. All 6 combinations passed:

- meaningful body content rendered;
- no blocking overlay;
- no horizontal overflow;
- no console or page errors;
- no HTTP response at or above 500.

## Logs and cleanup

The accepted deployment had no Vercel runtime error, warning, or fatal entries during the verification window. Generated credentials and keys were not copied to this report or PR output.

Final isolated cleanup counts were all zero:

| Resource | Remaining |
|---|---:|
| products | 0 |
| variants | 0 |
| Storage objects | 0 |
| upload/delete operations | 0 |
| developer credentials | 0 |

Obsolete test deployments and branch-only environment values must be removed after the exact-HEAD verification and merge.

## Conclusion

Phase 5B passed local tests, GitHub CI, isolated Preview business acceptance, responsive browser acceptance, and zero-residue cleanup. This is not evidence of production deployment or real barcode/label hardware compatibility.
