export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env.ALLOWED_ORIGIN)
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, env.ALLOWED_ORIGIN);
    }

    const origin = request.headers.get('Origin') || '';
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'forbidden_origin' }, 403, env.ALLOWED_ORIGIN);
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: 'invalid_json' }, 400, env.ALLOWED_ORIGIN);
    }

    const grantType = String(body.grant_type || '');
    if (grantType !== 'authorization_code') {
      return json({ error: 'unsupported_grant_type' }, 400, env.ALLOWED_ORIGIN);
    }

    const code = String(body.code || '');
    const codeVerifier = String(body.code_verifier || '');
    const redirectUri = String(body.redirect_uri || '');

    if (!code || !codeVerifier || !redirectUri) {
      return json({ error: 'missing_required_fields' }, 400, env.ALLOWED_ORIGIN);
    }

    const tokenPayload = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    let tokenResponse;
    try {
      tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenPayload.toString()
      });
    } catch (_) {
      return json({ error: 'google_token_endpoint_unreachable' }, 502, env.ALLOWED_ORIGIN);
    }

    const tokenJson = await tokenResponse.json().catch(() => ({}));
    const allowed = {
      access_token: tokenJson.access_token || null,
      expires_in: tokenJson.expires_in || null,
      id_token: tokenJson.id_token || null,
      scope: tokenJson.scope || null,
      token_type: tokenJson.token_type || null,
      error: tokenJson.error || null,
      error_description: tokenJson.error_description || null
    };

    if (!tokenResponse.ok) {
      return json(allowed, tokenResponse.status, env.ALLOWED_ORIGIN);
    }

    return json(allowed, 200, env.ALLOWED_ORIGIN);
  }
};

function corsHeaders(allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function json(payload, status, allowedOrigin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(allowedOrigin)
    }
  });
}
