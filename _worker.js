// Cloudflare Worker — Discord OAuth for Updraft Network
// Deploy this file as _worker.js in your Cloudflare Pages output directory
// Set environment variables:
//   DISCORD_CLIENT_ID     — from Discord Developer Portal
//   DISCORD_CLIENT_SECRET — from Discord Developer Portal
//   SESSION_SECRET        — random 32+ char string (run: openssl rand -hex 32)
//   ORIGIN                — your site URL (e.g. https://updraft.pages.dev)

const DISCORD_AUTH    = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN   = 'https://discord.com/api/oauth2/token';
const DISCORD_ME      = 'https://discord.com/api/users/@me';
const SCOPES          = 'identify';

async function encrypt(data, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret.padEnd(32).slice(0, 32)), { name: 'AES-CBC' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv); combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(payload, secret) {
  try {
    const raw = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
    const iv = raw.slice(0, 16);
    const data = raw.slice(16);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret.padEnd(32).slice(0, 32)), { name: 'AES-CBC' }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch { return null; }
}

function htmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function setCookie(name, value, maxAge = 86400) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function exchangeCode(code, clientId, clientSecret, origin) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${origin}/auth/callback`,
  });

  const res = await fetch(DISCORD_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) return null;
  return res.json();
}

async function fetchUser(token) {
  const res = await fetch(DISCORD_ME, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export default {
  async fetch(request, env) {
    const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET, ORIGIN } = env;
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !SESSION_SECRET || !ORIGIN) {
      return htmlResponse('Missing environment variables. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET, and ORIGIN.', 500);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // --- Initiate Discord login ---
    if (path === '/auth/discord') {
      const state = crypto.randomUUID();
      const authUrl = `${DISCORD_AUTH}?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(ORIGIN + '/auth/callback')}&response_type=code&scope=${SCOPES}&state=${state}`;
      return redirect(authUrl);
    }

    // --- OAuth callback ---
    if (path === '/auth/callback') {
      const { code, state } = Object.fromEntries(url.searchParams);
      if (!code) return htmlResponse('Missing authorization code.', 400);

      const tokens = await exchangeCode(code, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, ORIGIN);
      if (!tokens) return htmlResponse('Failed to exchange authorization code.', 400);

      const user = await fetchUser(tokens.access_token);
      if (!user) return htmlResponse('Failed to fetch user info.', 400);

      const session = await encrypt({
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        global_name: user.global_name,
      }, SESSION_SECRET);

      return new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie': setCookie('session', session),
        },
      });
    }

    // --- Get current user ---
    if (path === '/auth/me') {
      const cookie = request.headers.get('Cookie') || '';
      const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
      if (!match) return jsonResponse({ user: null });

      const user = await decrypt(match[1], SESSION_SECRET);
      return jsonResponse({ user });
    }

    // --- Logout ---
    if (path === '/auth/logout') {
      return new Response(null, {
        status: 302,
        headers: { Location: '/', 'Set-Cookie': clearCookie('session') },
      });
    }

    // --- Pass through for all other routes (Pages static assets) ---
    return env.ASSETS.fetch(request);
  },
};
