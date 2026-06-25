(function () {
  'use strict';

  const CHAT_STORAGE_KEY = 'updraft-chat-open';

  let chatOpen = localStorage.getItem(CHAT_STORAGE_KEY) === 'true';
  let messages = [];
  let currentUser = null;
  let pollInterval = null;
  let lastMessageId = null;

  const container = document.createElement('div');
  container.id = 'updraft-chat';
  container.innerHTML = `
    <div id="uc-toggle" title="Toggle Discord Chat">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12h6m-3-3v6m-7 7h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
      <span id="uc-unread" style="display:none">0</span>
    </div>
    <div id="uc-panel">
      <div id="uc-header">
        <div id="uc-header-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12h6m-3-3v6m-7 7h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
          <span>updraft-chat</span>
        </div>
        <div id="uc-header-right">
          <span id="uc-status-dot"></span>
          <span id="uc-status-text">connected</span>
          <button id="uc-close" title="Close">&times;</button>
        </div>
      </div>
      <div id="uc-messages">
        <div id="uc-loading">Loading messages...</div>
      </div>
      <div id="uc-input-area">
        <div id="uc-auth-msg">Log in with Discord to chat</div>
        <div id="uc-input-wrap" style="display:none">
          <textarea id="uc-input" rows="1" placeholder="Message #updraft-chat" maxlength="2000"></textarea>
          <button id="uc-send" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  const toggle = document.getElementById('uc-toggle');
  const panel = document.getElementById('uc-panel');
  const closeBtn = document.getElementById('uc-close');
  const messagesEl = document.getElementById('uc-messages');
  const loadingEl = document.getElementById('uc-loading');
  const inputWrap = document.getElementById('uc-input-wrap');
  const authMsg = document.getElementById('uc-auth-msg');
  const input = document.getElementById('uc-input');
  const sendBtn = document.getElementById('uc-send');
  const unreadEl = document.getElementById('uc-unread');
  const statusDot = document.getElementById('uc-status-dot');
  const statusText = document.getElementById('uc-status-text');

  let unreadCount = 0;
  let hasScrolledUp = false;

  function setConnected(ok) {
    statusDot.className = ok ? 'connected' : 'disconnected';
    statusText.textContent = ok ? 'connected' : 'disconnected';
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function formatDiscordMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="uc-codeblock"><code>$2</code></pre>');
    html = html.replace(/`(.+?)`/g, '<code class="uc-inline-code">$1</code>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/__([^_]+)__/g, '<u>$1</u>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function formatTimestamp(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function sameAuthor(a, b) {
    return a && b && a.author.id === b.author.id;
  }

  function timeDiff(a, b) {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return Math.abs(ta - tb) < 300000;
  }

  function renderMessages() {
    if (messages.length === 0) {
      messagesEl.innerHTML = '<div class="uc-empty">No messages yet. Be the first!</div>';
      return;
    }

    let html = '';
    let prev = null;

    for (const msg of messages) {
      const isGrouped = sameAuthor(prev, msg) && timeDiff(prev, msg);

      html += '<div class="uc-msg' + (isGrouped ? ' uc-grouped' : '') + '">';

      if (!isGrouped) {
        html += '<img class="uc-avatar" src="' + escapeHtml(msg.author.avatar_url) + '" alt="" loading="lazy" onerror="this.src=\'https://cdn.discordapp.com/embed/avatars/0.png\'">';
        html += '<div class="uc-body">';
        html += '<div class="uc-head">';
        html += '<span class="uc-name" style="color:' + nameColor(msg.author.id) + '">' + escapeHtml(msg.author.global_name || msg.author.username) + '</span>';
        if (msg.author.bot) html += '<span class="uc-bot-badge">BOT</span>';
        html += '<span class="uc-time">' + formatTimestamp(msg.timestamp) + '</span>';
        html += '</div>';
        html += '<div class="uc-content">' + formatDiscordMarkdown(msg.content) + '</div>';
      } else {
        html += '<div class="uc-body uc-continued">';
        html += '<div class="uc-time-side">' + formatTimestamp(msg.timestamp) + '</div>';
        html += '<div class="uc-content">' + formatDiscordMarkdown(msg.content) + '</div>';
      }

      html += '</div></div>';
      prev = msg;
    }

    messagesEl.innerHTML = html;
    if (!hasScrolledUp) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function nameColor(id) {
    const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#00AFFA', '#FF73FA', '#95EFFF'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  async function fetchMessages() {
    try {
      const res = await fetch('/api/channel/messages');
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const newMsgs = data.messages || [];
      newMsgs.reverse();

      const prevLen = messages.length;

      if (newMsgs.length > 0) {
        const latest = newMsgs[newMsgs.length - 1];
        if (latest.id !== lastMessageId) {
          lastMessageId = latest.id;
          messages = newMsgs;
          renderMessages();

          if (prevLen > 0 && !chatOpen) {
            const diff = messages.length - prevLen;
            if (diff > 0) {
              unreadCount += diff;
              updateUnread();
            }
          }
        }
      }

      setConnected(true);
    } catch (e) {
      setConnected(false);
    }
  }

  function updateUnread() {
    if (unreadCount > 0) {
      unreadEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
      unreadEl.style.display = 'flex';
    } else {
      unreadEl.style.display = 'none';
    }
  }

  async function sendMessage(content) {
    try {
      const res = await fetch('/api/channel/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      input.value = '';
      input.style.height = 'auto';
      sendBtn.disabled = true;
      await fetchMessages();
    } catch (e) {
      alert('Failed to send message: ' + e.message);
    }
  }

  async function checkAuth() {
    try {
      const res = await fetch('/auth/me');
      const data = await res.json();
      currentUser = data.user;
      if (currentUser) {
        authMsg.style.display = 'none';
        inputWrap.style.display = 'flex';
      } else {
        authMsg.style.display = 'block';
        authMsg.innerHTML = '<a href="/auth/discord" style="color:#5865F2;text-decoration:underline">Log in with Discord</a> to chat';
        inputWrap.style.display = 'none';
      }
    } catch {
      authMsg.style.display = 'block';
    }
  }

  function openChat() {
    chatOpen = true;
    localStorage.setItem(CHAT_STORAGE_KEY, 'true');
    panel.classList.add('open');
    toggle.classList.add('active');
    unreadCount = 0;
    updateUnread();
    hasScrolledUp = false;
    setTimeout(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 100);
  }

  function closeChat() {
    chatOpen = false;
    localStorage.setItem(CHAT_STORAGE_KEY, 'false');
    panel.classList.remove('open');
    toggle.classList.remove('active');
  }

  function toggleChat() {
    if (chatOpen) closeChat();
    else openChat();
  }

  toggle.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', closeChat);

  messagesEl.addEventListener('scroll', function () {
    const atBottom = this.scrollHeight - this.scrollTop - this.clientHeight < 60;
    hasScrolledUp = !atBottom;
  });

  input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    sendBtn.disabled = this.value.trim().length === 0;
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = this.value.trim();
      if (val) sendMessage(val);
    }
  });

  sendBtn.addEventListener('click', function () {
    const val = input.value.trim();
    if (val) sendMessage(val);
  });

  async function init() {
    await checkAuth();
    await fetchMessages();
    if (chatOpen) openChat();

    pollInterval = setInterval(fetchMessages, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
