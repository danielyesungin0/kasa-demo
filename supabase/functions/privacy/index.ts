// privacy — serves a simple public Privacy Policy page for Kasa, so Meta App
// publishing (and app stores) have a valid Privacy Policy URL. Public, no auth.
// verify_jwt=false. Plain HTML.

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kasa — Privacy Policy</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px;
      margin: 40px auto; padding: 0 20px; color: #211D18; line-height: 1.6; }
    h1 { font-size: 28px; } h2 { font-size: 19px; margin-top: 28px; }
    p, li { color: #534B41; } a { color: #6A5074; }
    .updated { color: #746A5C; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Kasa Privacy Policy</h1>
  <p class="updated">Last updated: June 2026</p>

  <p>Kasa is a messaging and booking assistant for independent stylists. It
  brings a stylist's client messages (e.g. Instagram) and their Square booking
  calendar into one app, so the stylist can read messages and book appointments.
  This policy explains what we handle and why.</p>

  <h2>Information we process</h2>
  <ul>
    <li><strong>Account &amp; authentication:</strong> your email and sign-in
      identity, to log you in.</li>
    <li><strong>Connected channels:</strong> when you connect Instagram, we
      access the messages clients send to your account so they appear in your
      Kasa inbox, and we send the replies you choose to send.</li>
    <li><strong>Booking data:</strong> when you connect Square, we read your
      services, staff, locations, and availability, and create the appointments
      you confirm.</li>
    <li><strong>Client details:</strong> names, contact info, and message
      history needed to manage conversations and bookings.</li>
  </ul>

  <h2>How we use it</h2>
  <p>Solely to provide the service: showing your messages, detecting booking
  intent, sending replies you approve, and creating bookings you confirm. We do
  not sell your data or use it for advertising.</p>

  <h2>Storage &amp; security</h2>
  <p>Data is stored on Supabase. Access tokens for connected accounts are
  encrypted at rest. Access is restricted to your own account.</p>

  <h2>Data deletion</h2>
  <p>You can disconnect a channel at any time, which revokes Kasa's access and
  removes its stored credentials. To delete your account and associated data,
  contact us at the email below.</p>

  <h2>Third parties</h2>
  <p>We integrate with Meta (Instagram) and Square strictly to provide the
  features above, per their platform terms.</p>

  <h2>Contact</h2>
  <p>Questions or deletion requests: <a href="mailto:danielin9799@gmail.com">danielin9799@gmail.com</a></p>
</body>
</html>`;

Deno.serve(() =>
  new Response(HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
);
