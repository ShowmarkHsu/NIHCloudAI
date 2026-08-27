# OpenRouter model and route decision

Date: 2026-08-27. The release owner authorized replacement of the fixed remote
model and route after the previous fixed route repeatedly failed the sealed
content-policy gate.

The selected fixed configuration is `openai/gpt-5.6-sol` through the single
`azure` provider route. It retains `response_format` JSON Schema strict mode,
`require_parameters: true`, `zdr: true`, `data_collection: "deny"`, and
`allow_fallbacks: false`. The request pins `provider.only: ["azure"]`; it may
fail when Azure is unavailable rather than send data to another provider.

Selection was based on the current official OpenRouter ZDR endpoint feed, which
advertised this endpoint as active and supporting `structured_outputs` and
`response_format`, and on OpenRouter's structured-output and provider-routing
documentation. The decision does not constitute clinical acceptance, real-data
validation, artifact approval, or release approval.

Sources: [ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[ZDR policy](https://openrouter.ai/docs/guides/features/zdr).
