// Tests mock fetch and count calls: keep the plugin's daily upstream check out of them.
process.env.OPENCODE_ANTHROPIC_UPDATE_CHECK = '0'
// A developer's own endpoint settings must not decide which origin the tests trust.
delete process.env.ANTHROPIC_BASE_URL
delete process.env.ANTHROPIC_INSECURE
