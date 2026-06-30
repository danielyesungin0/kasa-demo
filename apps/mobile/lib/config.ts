// App-level feature flags. Channels stay behind the same abstraction; a provider
// only goes "live" (real connect flow enabled) once its flag is true.
//
// SMS: provider not yet committed/approved. Provider-agnostic by design (Twilio
// first recommendation, swappable). Stays NOT live until a provider account +
// A2P 10DLC registration + a sending number exist. UI shows "Not set up" /
// registration states; no real send is attempted. Flip when credentials land.
export const SMS_LIVE = false;

// Meta-family channels (reuse the Instagram/Meta integration). Not live until
// the Meta app has them configured + reviewed.
export const WHATSAPP_LIVE = false;
export const MESSENGER_LIVE = false;

// Asia channels — not live until their provider accounts exist.
export const LINE_LIVE = false;
export const KAKAO_LIVE = false;
