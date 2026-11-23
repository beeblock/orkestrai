# Orkestrai 0.55.0 release review

The owner authorized publishing the tested Bots work and requested stronger default profiles and a dedicated website section. Version 0.55.0 is a compatible feature release over 0.54.0. Local previews remain development evidence, not public releases. Existing saved bots keep their instructions.

## Security review

The npm audit was repeated on November 23, 2026. Its moderate-or-higher findings resolve to the same two SvelteKit remote-function advisories guarded in 0.54.0. The official advisories explicitly restrict applicability to applications that enable experimental remote functions and use the affected functions:

- [GHSA-3r8g-jcqq-3p5j](https://github.com/sveltejs/kit/security/advisories/GHSA-3r8g-jcqq-3p5j), remote form parsing denial of service.
- [GHSA-6cf5-gc4q-fm3x](https://github.com/sveltejs/kit/security/advisories/GHSA-6cf5-gc4q-fm3x), private batch-query collisions.

Maintainer review for this version confirms `kit.experimental.remoteFunctions` remains explicitly false and the source contains no `.remote` modules. Bots use authenticated ordinary HTTP routes, not SvelteKit remote functions. The audit guard continues to check the exact SvelteKit version, source exclusion, pinned Picomatch archive integrity and parser SHA-256. Upstream patches for these SvelteKit findings are in 3.1.1; 2.70.4 remains the latest 2.x version at review time. This is an application mitigation, not an upstream package fix or a clean raw npm audit.

0.55.0 is individually listed as reviewed, alongside 0.54.0. The November 25, 2026 expiry is unchanged. No new advisory is accepted, no severity class is ignored, and prereleases, 0.54.1, 0.55.1 and 0.56.0 remain rejected. The focused regressions check those boundaries as well as enabled remote functions, added remote modules, changed security source and expiry. Future releases require another explicit review or remediation.

## Verification and scope

The release keeps the existing provider, account, native/WSL, public-worker, sender, workspace and file-delivery boundaries. Default-profile changes are text only and use the existing native UI and CLI/MCP catalog. All sixteen profiles are updated in Portuguese, English and Spanish; the creation form remains editable and does not add permissions.

Release preparation must pass the full suite, production build, relevant production browser checks, exact main-push CI, signed cross-platform installer verification and public asset/feed audit. Local ad-hoc testing does not prove signed-release hardware permissions. No failed public release may be overwritten.

The first candidate CI exposed harness readiness issues: a diagnostic-only first Windows CIM query ran before process discovery was ready, and two tests hit the default five-second budget while loading large module graphs. The Shell integration test now awaits real agent discovery before testing delivery, retaining provider, directory, reply and privacy assertions; production probe deadlines and identity checks are unchanged. The general CI suite now matches local release QA with two workers and a bounded twenty-second per-test deadline. Explicit performance assertions and operation-specific deadlines remain unchanged; no test is skipped or automatically retried to obtain a passing result.
