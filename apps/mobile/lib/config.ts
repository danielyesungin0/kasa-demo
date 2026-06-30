// App-level feature flags. Channels stay behind the same abstraction; a provider
// only goes "live" (real connect flow enabled) once its flag is true.
//
// WeChat: Official Account verification is submitted (~7-15 business days). Until
// the OA dashboard issues AppID/AppSecret + we set a webhook token and allowlist
// the Edge egress IPs, WeChat stays NOT live — the UI shows "Pending
// verification" and we don't attempt a real connect. Flip to true once creds are
// configured.
export const WECHAT_LIVE = false;

// SMS: provider not yet committed/approved. Provider-agnostic by design (Twilio
// first recommendation, swappable). Stays NOT live until a provider account +
// A2P 10DLC registration + a sending number exist. UI shows "Not set up" /
// registration states; no real send is attempted. Flip when credentials land.
export const SMS_LIVE = false;
