# LeProta fork of opencode-anthropic-auth (OpenCode v2)

Fork of [ex-machina-co/opencode-anthropic-auth](https://github.com/ex-machina-co/opencode-anthropic-auth)
`v2/main`, kept consistent with [LeProta/opencode-gemini-auth](https://github.com/LeProta/opencode-gemini-auth)
(same OpenCode V2 APIs, same module names, same upstream-tracking mechanism). The
ex-machina code (OAuth, refresh protection, tool aliases, streaming, compatibility
layer) is kept as it is; changes are bug fixes and features listed below, each in its
own commit so they can be offered upstream.

## Versioning

Both LeProta OAuth plugins use `MAJOR.MINOR.PATCH` in `package.json` and
`vMAJOR.MINOR.PATCH` for GitHub tags. Increment the major for incompatible changes,
the minor for compatible features, and the patch for fixes or documentation updates.
Each plugin advances independently; matching numbers do not imply matching features.
Fork versions are independent of upstream versions and client versions sent to APIs.

Version `2.1.0` renames `2.0.0-next.7-leprota.4` without runtime changes. Existing
tags remain available. The ex-machina base is recorded in [UPSTREAM.md](UPSTREAM.md),
not in the fork's version suffix.

Version `2.1.1` fixes: a 400 answer over 16 KB could hold the response forever, a 429
whose subscription window is `rejected` was retried, and a refresh token Anthropic had
already rotated away, or refused as `invalid_grant`, could be sent again. It reports
Claude Code 2.1.321 and is developed on Bun 1.4.4.

Version `2.2.0` removes the daily upstream check. The plugin no longer asks GitHub or
the npm registry anything, and `OPENCODE_ANTHROPIC_UPDATE_CHECK` is gone. Upstream
changes are followed by hand with `bun run check:upstream` (see
[UPSTREAM.md](UPSTREAM.md)). A version Anthropic asks for in a
`claude_code_version_too_old` answer is still adopted: that is an answer to your own
request, not a check.

## Install

```bash
opencode plugin add github:LeProta/opencode-anthropic-auth#v2.2.0
```

Replace `@ex-machina/opencode-anthropic-auth@…` in the `plugins` list if it is there:
two Anthropic OAuth plugins must not run together. `dist/` is committed, because
OpenCode installs GitHub plugins without building them.

Sign in with **Anthropic → Claude Pro/Max** (`opencode auth login anthropic`). The
method id stays `claude-max`, so a login made with the ex-machina plugin keeps working.
A login made by another plugin (for example `opencode-claude-auth`, method
`claude-code`) is not used: the plugin says so once in the log; sign in again.

## What differs from ex-machina

Fixes:

- A token refresh that never left the machine (`ECONNREFUSED`, `ENOTFOUND`,
  `EAI_AGAIN`, no route, connect timeout) no longer blocks the refresh token for the
  rest of the process (ex-machina issue #309). Timeouts after sending stay blocked,
  and so does any error whose cause chain holds another code, an abort or a timeout.
- The user's instruction files (`Instructions from: …` blocks) are never removed from
  the system prompt; CRLF prompts no longer lose everything after the identity line.
  OpenCode-link paragraphs are removed only inside OpenCode's own prompt (identity
  paragraph to environment block): an agent or custom system prompt that links to
  OpenCode's docs is kept.
- An unusable `ANTHROPIC_BASE_URL` (not https, http off localhost, embedded
  credentials) fails the request with a clear message instead of silently going to
  the official API.
- A forced `tool_choice` names the aliased tool, like the tool definitions.
- The `claude_code_version_too_old` check gives up after 1 s on a body that never
  arrives, instead of holding the response.
- A failed code exchange says why (bad input, other sign-in, refused code, network,
  bad answer).
- Reading a copy of a body never waits for its cancellation: a 400 answer over 16 KB
  without a `content-length` (or with invalid UTF-8) used to hold the response hook
  forever, past the 1 s budget above.
- A 429 whose `anthropic-ratelimit-unified-status` header is `rejected` is reported as a
  subscription limit and is not retried, whatever the wording of the message.
- A refresh token that Anthropic rotated away is never sent again by the same OpenCode
  process: a late `refresh` call with the old credential gets the successor (or a
  refresh of the successor once it expired). ex-machina forgot the rotation after 30 s,
  and when OpenCode disposed the plugin setup, and then sent the consumed token, which
  Anthropic refuses. The rotation is now remembered for the life of the process, across
  setups and across a re-import of the plugin after an update; the price is that up to
  256 refreshed credentials stay in memory after a setup is disposed. Past that bound
  the oldest rotated token is refused locally instead of being sent.
- A refresh token the token endpoint refuses with `invalid_grant` (used up, expired or
  revoked: RFC 6749 §5.2) is not sent again by the same process; the error says to sign
  in again. Any other 400 can still be retried on a later request, as before.
- None of this is written to disk: after OpenCode restarts, the plugin knows only the
  credential OpenCode stored. OpenCode 2.2.7 serialises refreshes of one credential
  across its processes with a lock file and re-reads the stored credential under it, so
  two windows do not send the same refresh token; that guarantee is the host's.
- `package.json` has an `exports` map, which OpenCode 2.2.7 needs to load a local
  `file://` checkout.

Features shared with the Google plugin:

- Prices of Anthropic models are zeroed while the Claude Pro/Max login is active.
- `claude_quota` tool and `/cquota` command: the `anthropic-ratelimit-*` headers of the
  last response (5-hour and weekly windows). No extra request. A snapshot is shown
  only while the login that received it is active.
- Manual upstream check (see [UPSTREAM.md](UPSTREAM.md)): `bun run check:upstream` lists
  what moved on ex-machina `v2/main` and in CLIProxyAPI's Claude files, and shows npm's
  latest Claude Code next to the version the plugin reports. The plugin itself checks
  nothing.
- Plugin id `leprota.anthropic-auth`.

Not added, on purpose: new Claude Code client-imitation mechanisms (`cch` signature,
client headers, imitated `metadata.user_id`, compression). See UPSTREAM.md.

Not implemented because they could not be verified: filtering models through
`/v1/models`, an account label from the OAuth profile, a localhost callback.

Not implemented on purpose: refresh-and-replay after a 401. Anthropic rotates the
refresh token on every refresh, and OpenCode 2.2.7 gives plugins no way to store a
credential (only `connection.active` / `connection.resolve`). A refresh made by the
plugin would leave OpenCode holding a consumed refresh token, and the login would be
lost at the next restart. Refreshes stay with OpenCode's `refresh` call.

## Configuration (in addition to the README's)

| Variable | Effect |
|----------|--------|
| `OPENCODE_ANTHROPIC_DEBUG=1` | Logs, per response, the model, HTTP status and the `anthropic-ratelimit-*` headers. Never bodies or tokens. |

## Development

Fork releases are published on GitHub with the matching `vMAJOR.MINOR.PATCH` tag
and `main` commit. The inherited `release:next` script is for ex-machina's npm
prerelease channel, not for these fork releases.

```bash
bun install --ignore-scripts
bun run types && bun run lint && bun test   # unset ANTHROPIC_BASE_URL first
bun run bundle                               # rebuild dist/ and commit it
bun run check:upstream                      # upstream commits not reviewed yet, npm's latest Claude Code
```

Bun is pinned to 1.4.4, the runtime OpenCode 2.2.7 embeds (ex-machina pins 1.3.14, where
`AbortSignal.timeout()` never fires in an idle `bun test` on Windows and
`version-rejection.test.ts` hangs). `.gitattributes` checks the sources out with LF so
`bun check` passes on Windows. CI runs on pushes to `main` and on pull requests, and fails
when `dist/` does not match the sources.

To take ex-machina's changes: merge `v2/main` from the upstream remote, run the tests,
rebuild `dist/`, then `bun run check:upstream -- --accept`.
