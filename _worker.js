// Cloudflare Worker — Discord OAuth + Channel Sync for Updraft Network
// Deploy this file as _worker.js in your Cloudflare Pages output directory
// Set environment variables:
//   DISCORD_CLIENT_ID      — from Discord Developer Portal
//   DISCORD_CLIENT_SECRET  — from Discord Developer Portal
//   DISCORD_BOT_TOKEN      — your Discord Bot token
//   DISCORD_CHANNEL_ID     — the channel ID to sync with
//   DISCORD_WEBHOOK_URL    — (optional) Discord Webhook URL for pretty messages with avatar/name
//   SESSION_SECRET         — random 32+ char string (run: openssl rand -hex 32)
//   ORIGIN                 — your site URL (e.g. https://updraft.pages.dev)

const API_BASE      = 'https://discord.com/api/v10';
const DISCORD_AUTH  = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token';
const DISCORD_ME    = 'https://discord.com/api/users/@me';
const SCOPES        = 'identify';

// Webhook URL for sending messages (optional, falls back to bot)
const HC_WEBHOOK_URL = "https://discord.com/api/webhooks/1519710656276992203/h2pwjCxmZZC-NMmDRMb2mtREyEt8zTYG8VKpjTjRbQ_TuJipBymfHN1ggk8DWuOOmBNl";

let statusCache = null;
let statusCacheTime = 0;

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
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
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
    try {
    const url = new URL(request.url);
    const path = url.pathname;

    const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET, ORIGIN } = env;

    // --- Initiate Discord login ---
    if (path === '/auth/discord') {
      if (!DISCORD_CLIENT_ID || !ORIGIN) return htmlResponse('Missing DISCORD_CLIENT_ID or ORIGIN env vars.', 500);
      const state = crypto.randomUUID();
      const authUrl = `${DISCORD_AUTH}?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(ORIGIN + '/auth/callback')}&response_type=code&scope=${SCOPES}&state=${state}`;
      return redirect(authUrl);
    }

    // --- OAuth callback ---
    if (path === '/auth/callback') {
      if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !ORIGIN || !SESSION_SECRET) return htmlResponse('Missing OAuth env vars.', 500);
      const { code, state } = Object.fromEntries(url.searchParams);
      if (!code) return htmlResponse('Missing authorization code.', 400);

      const tokens = await exchangeCode(code, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, ORIGIN);
      if (!tokens) return htmlResponse('Failed to exchange authorization code.', 400);

      const user = await fetchUser(tokens.access_token);
      if (!user) return htmlResponse('Failed to fetch user info.', 400);

      const avatarHash = user.avatar;
      const avatarUrl = avatarHash
        ? `https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;

      const session = await encrypt({
        id: user.id,
        username: user.username,
        avatar: avatarHash,
        global_name: user.global_name,
        avatar_url: avatarUrl,
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
      if (!SESSION_SECRET) return jsonResponse({ user: null });
      const cookie = request.headers.get('Cookie') || '';
      const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
      if (!match) return jsonResponse({ user: null });

      const user = await decrypt(match[1], SESSION_SECRET);
      return jsonResponse({ user });
    }

    // --- Avatar proxy (avoids Discord CDN blocking) ---
    if (path === '/auth/avatar') {
      if (!SESSION_SECRET) return new Response(null, { status: 401 });
      const cookie = request.headers.get('Cookie') || '';
      const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
      if (!match) return new Response(null, { status: 401 });

      const user = await decrypt(match[1], SESSION_SECRET);
      if (!user || !user.avatar) {
        const defaultNum = user ? parseInt(user.id) % 5 : 0;
        const url = `https://cdn.discordapp.com/embed/avatars/${defaultNum}.png`;
        const res = await fetch(url);
        return new Response(res.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=86400' } });
      }

      const url = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
      const res = await fetch(url);
      return new Response(res.body, {
        headers: {
          'Content-Type': res.headers.get('Content-Type') || 'image/png',
          'Cache-Control': 'public,max-age=86400',
        },
      });
    }

    // --- Logout ---
    if (path === '/auth/logout') {
      return new Response(null, {
        status: 302,
        headers: { Location: '/', 'Set-Cookie': clearCookie('session') },
      });
    }

    // --- Get messages from Discord channel ---
    if (path === '/api/channel/messages' && request.method === 'GET') {
      const DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
      const DISCORD_CHANNEL_ID = env.DISCORD_CHANNEL_ID;
      if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
        return jsonResponse({ error: 'Missing env vars', env: { has_bot: !!DISCORD_BOT_TOKEN, has_channel: !!DISCORD_CHANNEL_ID } }, 500);
      }

      const res = await fetch(`${API_BASE}/channels/${DISCORD_CHANNEL_ID}/messages?limit=50`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      });

      if (!res.ok) {
        const err = await res.text();
        return jsonResponse({ error: 'Failed to fetch messages', detail: err, status: res.status }, 502);
      }

      const messages = await res.json();
      const mapped = messages.map(m => ({
        id: m.id,
        content: m.content,
        timestamp: m.timestamp,
        author: {
          id: m.author.id,
          username: m.author.username,
          global_name: m.author.global_name,
          avatar_url: m.author.avatar
            ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(m.author.discriminator || '0') % 5}.png`,
          bot: m.author.bot || false,
        },
      }));

      return jsonResponse({ messages: mapped });
    }

    // --- Send message to Discord channel ---
    if (path === '/api/channel/messages' && request.method === 'POST') {
      const DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
      const DISCORD_CHANNEL_ID = env.DISCORD_CHANNEL_ID;
      if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
        return jsonResponse({ error: 'Missing env vars', env: { has_bot: !!DISCORD_BOT_TOKEN, has_channel: !!DISCORD_CHANNEL_ID } }, 500);
      }
      const DISCORD_WEBHOOK_URL = env.DISCORD_WEBHOOK_URL || HC_WEBHOOK_URL;

      const cookie = request.headers.get('Cookie') || '';
      const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
      if (!match) return jsonResponse({ error: 'Not authenticated' }, 401);

      const user = await decrypt(match[1], SESSION_SECRET);
      if (!user) return jsonResponse({ error: 'Invalid session' }, 401);

      const { content } = await request.json();
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return jsonResponse({ error: 'Content is required' }, 400);
      }

      // Use webhook if available for proper Discord-side formatting (avatar + username)
      if (DISCORD_WEBHOOK_URL) {
        const res = await fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            username: user.global_name || user.username,
            avatar_url: user.avatar_url,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return jsonResponse({ error: 'Failed to send message via webhook', detail: errText }, 502);
        }

        return jsonResponse({ ok: true });
      }

      // Fallback: send as bot message with username prefix
      const webhookContent = `**${user.global_name || user.username}** (${user.username}): ${content}`;

      const res = await fetch(`${API_BASE}/channels/${DISCORD_CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: webhookContent }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return jsonResponse({ error: 'Failed to send message', detail: errText }, 502);
      }

      return jsonResponse({ ok: true });
    }

    // --- Server Status (player count) ---
    if (path === '/api/status' && request.method === 'GET') {
      const now = Date.now();
      if (statusCache && now - statusCacheTime < 30000) return jsonResponse(statusCache);
      const res = await fetch('https://api.mcsrvstat.us/3/java.updraftnetwork.org');
      const data = await res.json();
      statusCache = {
        online: data.online || false,
        players: data.players ? data.players.online : 0,
        max: data.players ? data.players.max : 0,
        version: data.version || '1.21.4',
        motd: data.motd ? data.motd.clean : '',
      };
      statusCacheTime = now;
      return jsonResponse(statusCache);
    }

    // --- AI Chat proxy (Cloudflare Workers AI) ---
    if (path === '/api/chat' && request.method === 'POST') {
      if (!env.AI) return jsonResponse({ error: 'Workers AI not enabled — add AI binding in dashboard', keys: Object.keys(env).filter(k => !k.startsWith('_')) }, 500);

      const { messages } = await request.json();
      if (!messages || !Array.isArray(messages)) return jsonResponse({ error: 'messages array required' }, 400);

      const res = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages,
        max_tokens: 800,
        temperature: 0.7,
      });

      if (res.error) return jsonResponse({ error: 'Workers AI error', detail: res.error }, 502);

      return jsonResponse({
        choices: [{ message: { content: res.response } }]
      });
    }

    // --- Pass through for all other routes (Pages static assets) ---
    return env.ASSETS.fetch(request);
    } catch (e) {
      return jsonResponse({ error: 'Worker error', detail: e.message, stack: e.stack }, 500);
    }
  },
};
