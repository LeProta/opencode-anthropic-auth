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
export declare const UPSTREAM_SOURCES: readonly {
    readonly repo: string;
    readonly branch: string;
    readonly path: string;
    readonly reviewed: string;
}[];
