import { createHash } from 'node:crypto';
import { CCH_POSITIONS, CCH_SALT, CLAUDE_CODE_VERSION } from "./constants.js";
/**
 * Extract text from the first user message's first text block.
 */
export function extractFirstUserMessageText(messages) {
    const userMsg = messages.find((message) => message.role === 'user');
    if (!userMsg)
        return '';
    const { content } = userMsg;
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        const textBlock = content.find((block) => block.type === 'text');
        if (textBlock?.text)
            return textBlock.text;
    }
    return '';
}
/**
 * Compute cch: first 5 hex characters of SHA-256(messageText).
 */
export function computeCCH(messageText) {
    return createHash('sha256').update(messageText).digest('hex').slice(0, 5);
}
/**
 * Compute the 3-char version suffix from the sampled message characters.
 */
export function computeVersionSuffix(messageText, version = CLAUDE_CODE_VERSION) {
    const chars = CCH_POSITIONS.map((index) => messageText[index] || '0').join('');
    return createHash('sha256')
        .update(`${CCH_SALT}${chars}${version}`)
        .digest('hex')
        .slice(0, 3);
}
/**
 * Build the complete billing header string for insertion into system[0].
 */
export function buildBillingHeaderValue(messages, version = CLAUDE_CODE_VERSION, entrypoint) {
    const text = extractFirstUserMessageText(messages);
    const suffix = computeVersionSuffix(text, version);
    const cch = computeCCH(text);
    return ('x-anthropic-billing-header: ' +
        `cc_version=${version}.${suffix}; ` +
        `cc_entrypoint=${entrypoint}; ` +
        `cch=${cch};`);
}
/** Hash view of our canonical JSON.stringify output; matches Claude Code's dispatch exclusions. */
function hashView(value, depth = 0) {
    if (depth > 256)
        throw new Error('Claude CCH input exceeds the depth limit');
    if (Array.isArray(value))
        return `[${value.map((item) => hashView(item, depth + 1)).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value);
        const excluded = (key) => key === 'max_tokens' ||
            key === 'fallbacks' ||
            key === 'fallback_credit_token';
        const members = entries
            .filter(([key]) => !excluded(key))
            .map(([key, item]) => `${JSON.stringify(key)}:${key === 'model' && typeof item === 'string' ? '""' : hashView(item, depth + 1)}`);
        let trailing = 0;
        for (let i = entries.length - 1; i >= 0 && excluded(entries[i]?.[0] ?? ''); i--)
            trailing++;
        // Native hash view retains the preceding comma for a trailing run of 2+ dispatch fields.
        return `{${members.join(',')}${members.length && trailing > 1 ? ',' : ''}}`;
    }
    return JSON.stringify(value);
}
/** Sign after metadata, prompt and tool rewrites; only the billing block is changed. */
export function signRequestBody(body) {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || !('system' in parsed))
        return body;
    if (!Array.isArray(parsed.system))
        return body;
    const billing = parsed.system.find((block) => block?.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.startsWith('x-anthropic-billing-header:'));
    if (!billing || !/\bcch=[0-9a-f]{5};/.test(billing.text))
        return body;
    billing.text = billing.text.replace(/\bcch=[0-9a-f]{5};/, 'cch=00000;');
    const hash = (Bun.hash.xxHash64(hashView(parsed), 0x4d659218e32a3268n) & 0xfffffn)
        .toString(16)
        .padStart(5, '0');
    billing.text = billing.text.replace(/\bcch=00000;/, `cch=${hash};`);
    return JSON.stringify(parsed);
}
