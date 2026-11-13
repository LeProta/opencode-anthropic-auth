/**
 * Upstream sources this fork follows, same mechanism as the Google plugin's
 * src/upstream.ts. Notice only: the plugin never downloads or runs code.
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
export declare const UPDATE_CHECK_ENV_VAR = "OPENCODE_ANTHROPIC_UPDATE_CHECK";
export interface UpstreamCheckState {
    checkedAt: number;
    heads: Record<string, string>;
    npmLatest?: string;
}
export interface UpstreamCheckDeps {
    fetch?: typeof fetch;
    storage?: {
        get(key: string): Promise<unknown>;
        set(key: string, value: never): Promise<void>;
    };
    now?: number;
    env?: Record<string, string | undefined>;
}
/** What changed upstream since the recorded review, as one-line notices. */
export declare function upstreamNotices(state: UpstreamCheckState, reportedVersion: string): string[];
/** At most once per process and once a day (cached in plugin storage). */
export declare function checkUpstreamUpdate(reportedVersion: string, notify: (message: string) => void, deps?: UpstreamCheckDeps): Promise<void>;
/** Test hook: lets a test run the once-per-process check again. */
export declare function resetUpstreamCheckForTests(): void;
