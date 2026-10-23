# Developer feedback and observed friction

Recorded during the Task Desk sprint on October 23, 2026. These are observed development issues and integration decisions, not claims that Amazon services failed. No Alexa device, Alexa developer account integration, AWS runtime, Bee or Ring API was used. The Alexa+ experience is explicitly simulated.

## Tools used

- Official `@modelcontextprotocol/sdk` 1.32.1: actual MCP server and browser/verification clients over Streamable HTTP; protocol 2025-11-25.
- Node.js 20, Express 5 and Zod 4: runtime, same-origin HTTP service and tool input validation.
- esbuild: bundle the official MCP client and frontend source for the browser.
- Sumplus's public read-only model directory: recorded model/line rates and capacity metadata. No paid model endpoint was called.
- OpenAI Codex: development, tests, documentation and demo preparation. No runtime model inference.
- Browser UI capture and FFmpeg: actual application screen-capture segments and English demo assembly; no third-party music or Amazon logo.

## Friction 1: the Host-header negative probe did not send the intended Host

**Tool:** Node.js 20 fetch, during MCP transport verification.

**Task:** Prove that a DNS-rebinding-style request with `Host: evil.example` is refused.

**Steps:** Send a `tools/list` POST using fetch with a manually supplied Host header; expect 403.

**Expected:** The test would deliver the altered Host and measure the server's rejection.

**Actual:** The fetch request returned 200. A native HTTP/curl probe with the same intended Host returned 403. The first probe was not delivering the intended override, so it was not evidence that the server accepted the malicious Host.

**Severity:** Important for verification accuracy; no demonstrated server bypass.

**Workaround:** The reproducible verifier uses Node's native `http.request` for this one raw-header probe and the official MCP SDK Client for MCP interoperability. It also independently checks Origin 403, protocol 400, GET 405 and notification 202.

**Suggestion:** Include raw-header negative probes next to SDK transport examples so application developers can distinguish client-side header handling from an actual server protection failure.

## Friction 2: a fractional catalogue rate exposed our premature-rounding error

**Tool/data:** Catalogue pricing ingestion and our original arithmetic implementation.

**Task:** Estimate a two-million-token input using 1.2345674 USD/million, plus one output token at 1 USD/million.

**Expected:** The independently rounded total must be at least 2,469,136 micro-USD.

**Actual:** Rounding the input unit rate to an integer number of micro-USD per million first produced 2,469,135 micro-USD, one micro-dollar too low. This was our application bug, not an upstream SDK fault.

**Severity:** Important: an estimate below its intended ceiling invalidates the review promise.

**Workaround:** Convert the JSON number's round-trip decimal text to a rational value, multiply before division, and round each token-cost side upward. A specific regression test asserts 2,469,136 and covers scientific notation and tiny rates.

**Suggestion:** Catalogue APIs should state unit precision and rounding rules and preferably supply decimal price strings. Procurement examples should test fractional rates beyond six decimal places, not only integer-friendly prices.

## Friction 3: protocol sessions are not procurement state

**Tool:** Official MCP SDK Streamable HTTP transport and our application state integration.

**Task:** Make a human's approval refer to the exact reviewed task, even after edits, reloads, retries and server restarts.

**Expected:** Retrying a confirmed quote should return the original receipt; an unapproved stale quote should never approve a changed task.

**Actual:** Transport session handling alone does not define those business semantics. Treating a request/connection as an approval record would leave the meaning of retries and scope changes unspecified. This was a required integration decision, not a transport failure.

**Severity:** Important for the purchase-review workflow.

**Workaround:** Keep durable application workspaces independent of stateless MCP transport connections. Quotes bind revisions and snapshots; confirmations recalculate; duplicate quote IDs return the same receipt. Restart/reload withdraws pending quotes. Tests cover changed fields, expiry, cross-workspace IDs, persisted receipts and replay.

**Suggestion:** A small purchasing-oriented SDK example with human review, application revision binding and idempotent receipts would be useful alongside protocol examples.

## What worked well

The SDK's server/client pair made a real browser-to-tool path straightforward, with structured tool discovery and validation. Its supported current protocol version is 2025-11-25. The independent Client completed initialize, tools/list and actual tools/call. Express and Zod kept the HTTP and input boundaries small. esbuild bundled the same official client into a self-contained browser asset. Node's built-in test runner made business regression tests easy to run without a paid service.

The public Sumplus directory let us distinguish the same model on different service lines and inspect both capacity and listed rate. A frozen snapshot with provenance made demonstrations reproducible. Explicit historical replay avoids claiming that an old snapshot is a current quote.

## Onboarding and whether we would use these tools again

**Official MCP SDK:** A small server plus an official Client was a useful first end-to-end target. Production readiness still requires application-specific Origin/Host configuration, protocol validation, authentication and business-state design. We would use the SDK again because actual interoperability is testable independently of any particular assistant UI.

**Node / Express / Zod / esbuild:** The first local UI and tool call needed only npm installation and a browser build. We would use this stack again for a small reviewable prototype. It is not a substitute for production accounts, secure durable storage, operations and billing.

**Read-only Sumplus catalogue:** No credential or paid request was needed. We would use the snapshot approach again, while seeking documented decimal rate strings, rate precision and billing semantics before building actual purchasing.

**OpenAI Codex:** Useful for implementation, regression construction, documentation and iteration. We would use it again with independent tests and source review. Generated text and green tests alone do not prove product claims; no autonomous spending or runtime AI capability is claimed here.
