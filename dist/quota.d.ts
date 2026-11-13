/**
 * Subscription quota as Anthropic reports it on every Messages response
 * (`anthropic-ratelimit-*` headers). Read passively: no extra endpoint, no
 * extra request. Shown by the `claude_quota` tool and the `/cquota` command,
 * like the Google plugin's `google_quota` / `/gquota`.
 */
export declare const QUOTA_STORAGE_KEY = "ratelimit-snapshot";
export declare const DEBUG_ENV_VAR = "OPENCODE_ANTHROPIC_DEBUG";
export interface RateLimitSnapshot {
    capturedAt: number;
    status: number;
    headers: Record<string, string>;
}
/** The rate-limit headers of a response, bounded; undefined when it has none. */
export declare function captureRateLimitHeaders(response: Response, now?: number): RateLimitSnapshot | undefined;
export declare function formatQuota(snapshot: RateLimitSnapshot | undefined, now?: number): string;
export declare function isDebugEnabled(env?: Record<string, string | undefined>): boolean;
