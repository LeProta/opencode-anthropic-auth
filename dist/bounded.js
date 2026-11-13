export class BodyLimitError extends Error {
    constructor(label, limit) {
        super(`${label} exceeds ${limit} byte limit`);
        this.name = 'BodyLimitError';
    }
}
export class InvalidUtf8Error extends Error {
    constructor(label) {
        super(`${label} is not valid UTF-8`);
        this.name = 'InvalidUtf8Error';
    }
}
export function contentLength(headers) {
    const raw = headers.get('content-length');
    if (!raw || !/^\d+$/.test(raw))
        return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : undefined;
}
export async function readBoundedText(body, limit, label, 
/** Aborting cancels the body and rejects, so a stalled body cannot hang the caller. */
signal) {
    if (!body)
        return '';
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parts = [];
    let total = 0;
    const onAbort = () => {
        reader.cancel(signal?.reason).catch(() => { });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        while (true) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            // A cancelled read resolves as done: report the abort, not a short body.
            signal?.throwIfAborted();
            if (done)
                break;
            total += value.byteLength;
            if (total > limit) {
                await reader.cancel().catch(() => { });
                throw new BodyLimitError(label, limit);
            }
            try {
                parts.push(decoder.decode(value, { stream: true }));
            }
            catch {
                throw new InvalidUtf8Error(label);
            }
        }
        try {
            parts.push(decoder.decode());
        }
        catch {
            throw new InvalidUtf8Error(label);
        }
        return parts.join('');
    }
    catch (error) {
        await reader.cancel(error).catch(() => { });
        throw error;
    }
    finally {
        signal?.removeEventListener('abort', onAbort);
        reader.releaseLock();
    }
}
