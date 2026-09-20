# Video provider contracts

The creative-media module routes video jobs through its existing provider port.
`config.provider` defaults to `fal` for persisted workflows and run snapshots.
Profiles have immutable provider identity. Do not infer the provider from an
endpoint name: Higgsfield and fal can publish the same ID with different schemas.

## Catalogs

- fal: existing live discovery and OpenAPI normalization, unchanged.
- BytePlus ModelArk: reviewed native adapter contract in `domain/byteplus-models.ts`.
  The adapter maps named frame/reference slots into official `content` entries.
- Higgsfield: reviewed JSON schemas from official model API-reference pages in
  `domain/higgsfield-video-contracts.json`. This is a versioned supported catalog,
  not a claim that every future provider model is automatically available.

Refresh the Higgsfield snapshot with
`node scripts/sync-higgsfield-video-contracts.mjs`. This maintenance command reads
public schema data without evaluating website JavaScript. Review the full diff,
especially media roles, prices, defaults and enum changes; run the creative unit,
feature and browser tests before committing. Runtime refresh does not scrape the
provider website. Retain verification dates; do not bake temporary promotions
into list prices or represent unverified endpoints as supported.

Official references, checked September 20, 2026:

- [Higgsfield documentation index](https://docs.higgsfield.ai/docs/llms.txt)
- [Higgsfield H3 contract](https://open.higgsfield.ai/models/minimax/h3/image-to-video/api-reference)
- [ModelArk create task](https://docs.byteplus.com/en/docs/ModelArk/1520757)
- [ModelArk retrieve task](https://docs.byteplus.com/en/docs/ModelArk/1521309)
- [ModelArk delete task](https://docs.byteplus.com/en/docs/ModelArk/1521720)
- [ModelArk pricing](https://docs.byteplus.com/en/docs/ModelArk/1544106)

## Credentials and outbound data

Only the desktop vault stores provider credentials. Agents receive account IDs,
grants and model contracts, never resolved keys. Validate account/provider parity
before resolving a credential, including restart recovery and downloads.

Higgsfield uses `Authorization: Key KEY_ID:KEY_SECRET`. Its configured quote
requires the same media inputs as generation, so Estimate uploads approved local
references through signed storage URLs under the outbound integration gate.
Storage uploads/downloads never receive API authorization headers. Upload URLs,
headers, states and model data are bounded and allowlisted. No authenticated
request follows redirects. Provider errors never expose raw upstream bodies.

BytePlus uses a ModelArk Bearer key and the Singapore API origin. It accepts
inline local images/audio. This adapter requires public HTTPS URLs for input
videos; it neither publishes private videos elsewhere nor invents a file-ID API.
Text/first-last-frame/omni-reference modes are validated before submission.
Direct ModelArk edit/extend modes are not exposed by this adapter.

## Costs and lifecycle

Higgsfield estimates the configured input using its account quote endpoint;
public model rates are separately labeled and may differ from the account quote.
BytePlus uses dated token list rates, explicit duration/resolution and conservative
input-video duration. Existing fal estimation remains unchanged. Reservations are
local admission controls, not a contractual ceiling on the provider's invoice.

Every run freezes provider, account, model contract, revision and media hashes.
An ambiguous paid response is never automatically submitted again. Downloads
resume through the frozen provider, even after renderer/app restarts. Never
persist temporary upload URLs or credentials into generated run snapshots.

ModelArk DELETE can cancel a queued task or erase an already completed record.
A GET-then-DELETE check is racy, so submitted ModelArk jobs cannot be cancelled
through Orkestrai. They remain tracked and downloaded. Local queued cancellation
is still safe. Higgsfield cancellation is reconciled against actual remote status.

Contract/unit/browser fixtures do not prove live account access, output quality,
billing, or provider availability. A real integration acceptance requires an
owner-configured key, model access, explicit budget and paid-run authorization.
