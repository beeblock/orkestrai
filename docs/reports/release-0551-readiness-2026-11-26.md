# Orkestrai 0.55.1 release review

The owner confirmed the local account-switch fix and authorized publication. This is a compatible patch over 0.55.0. Preserve the working local preview and its selected account while preparing the public release.

## Profile continuity

The previous transfer rejected an approximately 572 MiB saved Claude context with `PROFILE_SESSION_TOO_LARGE`, although the destination had sufficient free space. Replace the fixed 512 MiB total-size ceiling with a disk-budget check. Retain the 512 MiB free-space reserve, bounded 64 KiB streaming, file/depth bounds, UUID and workspace/session ownership checks, symlink and credential-path rejection, and divergent-history protection. After staging, reserve only remaining headroom rather than another copy of the same bytes. Account credential files are excluded from the transfer, and resolved authentication environment values are not added to persisted node payloads. Existing saved conversation content is preserved rather than treated as an authentication store.

Four focused regressions cover a sparse context above 512 MiB, insufficient space before transfer, correct post-staging accounting, and cleanup when headroom disappears during copying. Existing continuity, account isolation, native/WSL, bridge identity and UI roundtrip assertions remain in place. The local preview passed 79 focused tests, a production build and a production-browser profile roundtrip. A real owner-authorized switch completed in 5.24 seconds with the same conversation identifier; the live process used the selected profile directory. The saved conversation and 267 session companion files matched source prefixes. Native rewind snapshots may change after the provider resumes; this is not evidence that all live files remain immutable. The owner confirmed the result.

## Fresh security review, November 26

The former review expired on November 25. Maintainer review for this version was performed again by Codex, rather than applying the expired review to another release. A fresh npm audit still resolves its moderate-or-higher findings to the same two SvelteKit remote-function advisories:

- https://github.com/sveltejs/kit/security/advisories/GHSA-3r8g-jcqq-3p5j
- https://github.com/sveltejs/kit/security/advisories/GHSA-6cf5-gc4q-fm3x

Both official advisories require enabled experimental remote functions and use of the affected functions. `kit.experimental.remoteFunctions` remains explicitly false, and the source has no `.remote` modules. The profile fix adds ordinary internal service logic and no remote-function entry point. The registry still lists 2.70.4 as the latest SvelteKit 2.x version; the advisory fixes are in 3.1.1. A framework-major migration is separate from this narrow profile patch.

The exact Picomatch source commit, archive integrity and parser SHA-256 are unchanged and continue to be checked with bounded amplification regressions. No additional advisory or severity class is accepted. The raw audit is not clean: low-severity findings and the guarded SvelteKit findings remain upstream. The reviewed gate must report zero blocking findings; this is an application mitigation, not an upstream dependency fix.

Only 0.55.1 receives a new review window: November 26 through November 28, 2026 UTC. The old 0.54.0 and 0.55.0 windows still end November 25; the new review cannot revive them. Tests cover unreviewed versions and prereleases, calls before the new review, expiry, enabled remote functions, remote modules and modified security source. Future releases require their own review or remediation.

## Publication gates

The new focused profile/security/docs/artifact checks passed 71 tests. Before tagging, require the full regression suite, production build, relevant browser continuity check, synchronized app/site catalogs and exact main-push CI. Publication must verify signed/notarized Mac Intel and Apple Silicon packages, native ARM voice and startup, Windows upgrade/startup, Linux startup, all 15 installers/manifests/blockmaps and the public update feeds. A local ad-hoc preview does not prove release signing or every hardware permission.

Local full regression result: 423 test files passed and 13 were conditionally skipped; 3,606 tests passed, 38 skipped, zero failures (two workers, 20-second test budget).

The final 0.55.1 production build and isolated production-browser account roundtrip passed (1/1). Website validation passed 42 tests and its production build; commit 5993f84 was deployed successfully and all three public changelog pages returned HTTP 200 with 0.55.1. Exact main CI and public installer/feed verification remain publication gates.
