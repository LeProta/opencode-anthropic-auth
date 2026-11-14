/**
 * Upstream sources this fork follows, same mechanism as the Google plugin's
 * src/upstream.ts. Provenance only: the plugin never reads this at run time;
 * `bun run check:upstream` compares it with GitHub when you ask.
 *
 * - ex-machina v2/main is the fork base: new commits there should be merged.
 * - CLIProxyAPI's Claude executor is the reference wire format: changes there
 *   are reviewed against constants.ts / cch.ts / transform.ts, never copied
 *   automatically (see UPSTREAM.md).
 *
 * Updated by `bun run check:upstream -- --accept`; do not edit by hand.
 */
export const UPSTREAM_SOURCES = [
    {
        repo: 'ex-machina-co/opencode-anthropic-auth',
        branch: 'v2/main',
        path: '',
        reviewed: '59a09c8ce61fddc8c84c59c2271fd3b62d01be19',
    },
    {
        repo: 'router-for-me/CLIProxyAPI',
        branch: 'main',
        path: 'internal/runtime/executor/claude_signing.go',
        reviewed: '65de937cf19b88436ee8519caa42f0fcb66e2307',
    },
    {
        repo: 'router-for-me/CLIProxyAPI',
        branch: 'main',
        path: 'internal/runtime/executor/claude_executor_request.go',
        reviewed: '02ec93d004edb830d65fa24d699322abd291e03f',
    },
    {
        repo: 'router-for-me/CLIProxyAPI',
        branch: 'main',
        path: 'internal/runtime/executor/claude_executor_cloaking.go',
        reviewed: 'fa11a573b252b30256bef4de952a95feee3c8c9d',
    },
    {
        repo: 'router-for-me/CLIProxyAPI',
        branch: 'main',
        path: 'internal/runtime/executor/helps/claude_device_profile.go',
        reviewed: 'b4e7dbd2c984ec4a74d829ee0425430a20146c77',
    },
    {
        repo: 'router-for-me/CLIProxyAPI',
        branch: 'main',
        path: 'internal/auth/claude/anthropic.go',
        reviewed: 'f3e25ab2bae6e7d533637d3ef1b64722525435d4',
    },
];
