/**
 * True only when the whole cause chain says "never sent": one undelivered code
 * and no other error code, abort or timeout at any level. Anything ambiguous
 * keeps ex-machina's replay protection.
 */
export declare function isUndeliveredNetworkError(error: unknown): boolean;
export type AuthorizationResult = {
    url: string;
    redirectUri: string;
    state: string;
    verifier: string;
};
export declare function authorize(mode: 'max' | 'console'): Promise<AuthorizationResult>;
export type ExchangeResult = {
    type: 'success';
    refresh: string;
    access: string;
    expires: number;
} | {
    type: 'failed';
    reason: ExchangeFailureReason;
};
/** Why a code exchange failed, safe to show (never echoes the code or a token). */
export type ExchangeFailureReason = 'invalid_input' | 'state_mismatch' | 'rejected' | 'network' | 'invalid_response';
export declare function exchange(input: string, verifier: string, redirectUri: string, expectedState?: string): Promise<ExchangeResult>;
export type RefreshResult = {
    type: 'success';
    refresh: string;
    access: string;
    expires: number;
}
/**
 * `delivered: false` means the request never left the machine (see isUndeliveredNetworkError).
 * `rejected: true` means the provider answered `invalid_grant`: the token is used up,
 * expired or revoked (RFC 6749 §5.2) and sending it again can never succeed.
 */
 | {
    type: 'failed';
    status: number;
    delivered?: false;
    rejected?: true;
};
/**
 * Exchange a refresh token for a new access/refresh token pair.
 * Refresh tokens may rotate after a request reaches the provider. Retrying an
 * ambiguous 5xx, timeout, network failure, or response-body failure can replay
 * an already consumed token, so each call makes exactly one token request.
 */
export declare function refreshToken(refreshTokenValue: string): Promise<RefreshResult>;
export declare function exchangeFailureMessage(reason: ExchangeFailureReason): string;
