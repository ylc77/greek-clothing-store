## Summary

Phase 6A hardens the storefront channel, SEO, legal, monitoring, and accessibility boundaries without changing POS, inventory, CSV, image lifecycle, or AI transaction semantics.

### Skroutz and monitoring

- Generate Feed records from the approved public projection and authoritative `MAIN_STORE` Variant balances.
- Exclude reserved or unsaleable stock and fail closed for incomplete fashion Variants.
- Require real English copy, manufacturer/brand, MPN, EAN, HTTPS images, recorded image dimensions over 1,000 pixels, fashion color, and additional images for sized fashion products.
- Validate XML structure, required fields, quantity totals, duplicate IDs, image rules, crawler user agents, and feeds beyond the Supabase 1,000-row page boundary.
- Upgrade the Daily site monitor workflow to strict Feed validation and Node 24-compatible actions.

### SEO and browser security

- Render Greek or English `lang`, canonical, reciprocal `hreflang`, and `x-default` in the server response.
- Add localized sitemap alternates and protect admin routes from indexing.
- Add request-scoped CSP nonces and response security headers.

### Legal publishing

- Keep independent Greek and English retail policy content.
- Reject incomplete bilingual publishing.
- Publish the current settings and immutable version snapshot in one service-role-only PostgreSQL transaction.
- Show only enabled third-party services and disclose request-only AI body measurements without storing them.

### Accessibility

- Correct storefront/footer/admin contrast and form labels.
- Gate serious/critical axe violations, keyboard access, and horizontal overflow at 390, 768, and 1440 pixels.

## Local verification

- `npm run check:channels-static`
- `npm run test:channels-unit` — 14/14 passed
- `npm run typecheck`
- `npm run test:legal-publish-integration`
- `npm run test:channels-browser-local`
- `npm run test:ai-auth-install-paths`
- `git diff --check`

All listed checks passed. The production build completed successfully. The ordered migration chain, generated client snapshot, legacy upgrade fixture, legal publish concurrency, rollback, and cleanup checks passed.

## Required before merge

- All four required GitHub jobs green for the exact PR HEAD.
- Isolated Vercel/Supabase Preview acceptance using test-only credentials and `AUDIT_6A_` fixtures.
- Strict live Feed monitor and official Skroutz XML Validator pass.
- Greek/English raw HTML, legal publishing, Cookie preferences, headers, accessibility, and admin readiness verified in Preview.
- Preview database, Storage, credential, Cookie, and environment-variable cleanup proven complete.
- Solo-maintainer sign-off and immutable local/CI/Preview tags.

## Explicitly not verified

- Production deployment is not verified.
- Real customer data is not used.
- Real POS, scanner, label-printer, or receipt-printer hardware is not part of Phase 6A.
- The currently failing production Daily site monitor is not considered resolved until this branch is deployed and the target environment contains an eligible Feed product.
