// App-level feature flags. Channels stay behind the same abstraction; a provider
// only goes "live" (real connect flow enabled) once its flag is true.
//
// WeChat: Official Account verification is submitted (~7-15 business days). Until
// the OA dashboard issues AppID/AppSecret + we set a webhook token and allowlist
// the Edge egress IPs, WeChat stays NOT live — the UI shows "Pending
// verification" and we don't attempt a real connect. Flip to true once creds are
// configured.
export const WECHAT_LIVE = false;
