// terms — serves a public Terms of Service page for Kasa, so App Store / Meta
// review have a valid ToS URL. Public, no auth. verify_jwt=false. Placeholder
// content until legal copy is finalized.

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kasa — Terms of Service</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px;
      margin: 40px auto; padding: 0 20px; color: #211D18; line-height: 1.6; }
    h1 { font-size: 28px; } h2 { font-size: 19px; margin-top: 28px; }
    p, li { color: #534B41; } a { color: #6A5074; }
    .updated { color: #746A5C; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Kasa Terms of Service</h1>
  <p class="updated">Last updated: June 2026</p>

  <p>These terms govern your use of Kasa, a messaging and booking assistant for
  independent stylists. By using Kasa, you agree to these terms.</p>

  <h2>The service</h2>
  <p>Kasa brings your client messages (e.g. Instagram) and your Square booking
  calendar into one app so you can read messages and create appointments. You
  remain responsible for the content you send and the appointments you confirm.
  Kasa never sends a message or creates a booking without your explicit action.</p>

  <h2>Connected accounts</h2>
  <p>You authorize Kasa to access your connected Instagram and Square accounts
  only to provide these features, subject to those platforms' own terms. You can
  disconnect at any time, which revokes Kasa's access.</p>

  <h2>Acceptable use</h2>
  <p>Don't use Kasa to send spam, harass, or violate any platform's policies or
  applicable law.</p>

  <h2>Disclaimer</h2>
  <p>Kasa is provided "as is" without warranties. We aren't liable for missed
  messages, booking errors, or third-party platform outages to the extent
  permitted by law.</p>

  <h2>Changes</h2>
  <p>We may update these terms; continued use means you accept the updates.</p>

  <h2>Contact</h2>
  <p><a href="mailto:danielin9799@gmail.com">danielin9799@gmail.com</a></p>
</body>
</html>`;

Deno.serve(() =>
  new Response(HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
);
