/**
 * Subscription quota as Anthropic reports it on every Messages response
 * (`anthropic-ratelimit-*` headers). Read passively: no extra endpoint, no
 * extra request. Shown by the `claude_quota` tool and the `/cquota` command,
 * like the Google plugin's `google_quota` / `/gquota`.
 */
const HEADER_PATTERN = /^anthropic-ratelimit-[a-z0-9-]{1,80}$/;
const MAX_VALUE_LENGTH = 200;
const MAX_HEADERS = 40;
export const QUOTA_STORAGE_KEY = 'ratelimit-snapshot';
export const DEBUG_ENV_VAR = 'OPENCODE_ANTHROPIC_DEBUG';
/** The rate-limit headers of a response, bounded; undefined when it has none. */
export function captureRateLimitHeaders(response, now = Date.now()) {
    const headers = {};
    let count = 0;
    response.headers.forEach((value, name) => {
        const key = name.toLowerCase();
        if (count >= MAX_HEADERS || !HEADER_PATTERN.test(key))
            return;
        if (value.length > MAX_VALUE_LENGTH)
            return;
        headers[key] = value;
        count += 1;
    });
    return count
        ? { capturedAt: now, status: response.status, headers }
        : undefined;
}
function relative(ms) {
    if (ms <= 0)
        return 'now';
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60)
        return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48)
        return `${hours} h ${minutes % 60} min`;
    return `${Math.round(hours / 24)} days`;
}
/** Anthropic sends resets as epoch seconds (unified) or RFC 3339 (per-minute). */
function resetIn(value, now) {
    const seconds = Number(value);
    const at = Number.isFinite(seconds) && /^\d+$/.test(value)
        ? seconds * 1000
        : Date.parse(value);
    return Number.isNaN(at) ? undefined : relative(at - now);
}
export function formatQuota(snapshot, now = Date.now()) {
    if (!snapshot) {
        return 'Claude subscription quota: no Anthropic response seen yet for the active Claude Pro/Max login. Send a message with a Claude model first.';
    }
    const h = snapshot.headers;
    const lines = [
        `Claude subscription quota (from the last response, ${relative(now - snapshot.capturedAt)} ago, HTTP ${snapshot.status}):`,
    ];
    const status = h['anthropic-ratelimit-unified-status'];
    if (status)
        lines.push(`- status: ${status}`);
    for (const [window, label] of [
        ['5h', '5-hour window'],
        ['7d', 'weekly window'],
    ]) {
        const utilization = Number(h[`anthropic-ratelimit-unified-${window}-utilization`]);
        const reset = h[`anthropic-ratelimit-unified-${window}-reset`];
        if (!Number.isFinite(utilization) && !reset)
            continue;
        const used = Number.isFinite(utilization)
            ? `${Math.round(utilization * 100)}% used`
            : 'usage unknown';
        const when = reset ? resetIn(reset, now) : undefined;
        lines.push(`- ${label}: ${used}${when ? `, resets in ${when}` : ''}`);
    }
    const known = new Set([
        'anthropic-ratelimit-unified-status',
        'anthropic-ratelimit-unified-5h-utilization',
        'anthropic-ratelimit-unified-5h-reset',
        'anthropic-ratelimit-unified-7d-utilization',
        'anthropic-ratelimit-unified-7d-reset',
    ]);
    const others = Object.entries(h).filter(([name]) => !known.has(name));
    if (others.length) {
        lines.push('', 'Other rate-limit headers:');
        for (const [name, value] of others.sort())
            lines.push(`- ${name}: ${value}`);
    }
    return lines.join('\n');
}
export function isDebugEnabled(env = process.env) {
    return (env[DEBUG_ENV_VAR] ?? '').trim() === '1';
}
