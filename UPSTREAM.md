# Upstream sources

The fork has its own `MAJOR.MINOR.PATCH` versions. Its ex-machina base is
`2.0.0-next.7`, commit `59a09c8ce61fddc8c84c59c2271fd3b62d01be19` on `v2/main`;
this upstream prerelease version does not determine the fork's version format.

This fork follows two upstreams, recorded in `src/upstream.ts`. They are checked by
hand with `bun run check:upstream`, which asks GitHub for the commits not reviewed yet
and the npm registry for the latest Claude Code release. The plugin itself checks
nothing and prints no notice:

- **ex-machina-co/opencode-anthropic-auth, `v2/main`** is the fork base. New commits
  there are merged into this fork.
- **router-for-me/CLIProxyAPI**, Claude executor files, is a reference for the wire
  format. Changes there are reviewed against `src/constants.ts`, `src/cch.ts` and
  `src/transform.ts`; nothing is copied automatically.

## Wire format: this fork vs CLIProxyAPI

Reviewed at CLIProxyAPI `1aaf56b` (12 Nov 2026) and ex-machina `59a09c8`.

| Item | This fork (ex-machina base) | CLIProxyAPI | Decision |
|------|-----------------------------|-------------|----------|
| Reported Claude Code version | 2.1.321 bundled (ex-machina: 2.1.280); `ANTHROPIC_CLAUDE_CODE_VERSION` override; adopts the version a `claude_code_version_too_old` 400 asks for | 2.1.321 | Kept. `bun run check:upstream` shows npm's latest next to it; the bundled version is raised by hand in `src/constants.ts`. |
| `cch` in the billing block | SHA-256 of the first user message (5 hex) | xxHash64 over the final body with a `cch=00000` placeholder | Not ported (see below). |
| `cc_entrypoint` | `sdk-cli` | `cli` | Unchanged. |
| `anthropic-beta` | `oauth-2025-04-20`, `interleaved-thinking-2025-05-14`, plus the caller's | Per-request list (up to ~30 betas) | Unchanged; a beta is added only for a feature OpenCode actually uses. |
| `X-App`, `X-Stainless-*`, `X-Claude-Code-Session-Id` | Not sent | Sent | Not ported (see below). |
| `metadata.user_id` | Not set | Set | Not ported (see below). |
| Body compression | None | Conditional | Not ported (see below). |
| System prompt | Claude Code identity line, OpenCode paragraphs removed; the user's instruction files are kept verbatim | Its own instructions block | Kept. |
| Tool names | Reversible `mcp_T…` / `mcp_H…` aliases, `tool_choice` included | BIP-39 word aliases | Kept. |
| TLS | Bun's `fetch` | uTLS imitation of Claude Code's TLS handshake | Not possible: an OpenCode plugin cannot change how Bun negotiates TLS. |

### Why the client-imitation items are not ported

The `cch` signature, the Claude Code client headers, the imitated `metadata.user_id`
and the compression pattern exist to make a third-party client pass as Claude Code
in Anthropic's client checks. This fork does not add mechanisms whose only purpose is
to get around those checks. It keeps the ex-machina base as it is, and fixes bugs that
hurt users (lost instructions, blocked refreshes, hanging reads, broken requests).

If Anthropic starts rejecting requests because of one of these items, the plugin will
fail visibly; the fix is then a decision to take in the open, not a silent update.
