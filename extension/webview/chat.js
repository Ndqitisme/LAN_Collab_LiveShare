'use strict';

// Runs inside the chat webview. Every piece of a message is inserted with textContent / text nodes,
// never as HTML, because messages come from other machines.
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const log = $('log');
  const input = $('input');
  const sendBtn = $('send');
  const jump = $('jump');

  const IMAGE_MAX = 4 * 1024 * 1024; // the hub refuses anything larger
  const REENCODE_OVER = 1.5 * 1024 * 1024;
  const MAX_SIDE = 1920;
  const GROUP_MS = 5 * 60 * 1000;

  const EMOJI = [
    ['Mặt cười', '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 😘 😋 😛 😜 🤪 🤗 🤔 🤨 😐 😑 😶 🙄 😏 😬 😌 😴 😷 🤒 🤯 😎 🤓 🧐 😕 😟 😮 😲 😳 🥺 😢 😭 😱 😤 😡 🤬'],
    ['Cử chỉ', '👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 🙏 💪 👋 🤙 👉 👈 👆 👇 ☝️ ✋ 🤚 🖐️ 🫡 🤷 🤦 🙋 🙆 🙅 👀 🧠'],
    ['Làm việc', '✅ ❌ ⚠️ ❓ ❗ 💡 🔥 🚀 🎯 🐛 🔧 🛠️ ⚙️ 🔍 📌 📎 📝 📄 📁 📊 💻 🖥️ ⌨️ 🖱️ 🧪 🔒 🔑 ⏳ ⏰ 📅 ☕ 🍜'],
    ['Biểu tượng', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 ✨ ⭐ 🌟 🎉 🎊 🏆 🥇 👑 💎 🎁 🌈 ☀️ 🌙 ⚡ 💤 💬 💭 🔔 ➕ ➖ ✔️ ➡️ ⬅️ 🔁'],
  ];

  const saved = vscode.getState() || {};
  let recent = Array.isArray(saved.recent) ? saved.recent : [];
  let users = [];
  let connected = false;
  let attachment = null; // {mime, b64, w, h, src, size}
  let sending = false;
  let unseen = 0;
  let last = null; // last rendered message, for grouping
  const mediaSrc = new Map(); // image id -> data URI
  const mediaWait = new Map(); // image id -> <img> elements waiting for it

  input.value = saved.draft || '';

  function save() {
    vscode.setState({ draft: input.value, recent });
  }

  // ------------------------------------------------------------ header

  function initials(name) {
    const parts = String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
    return s.toUpperCase();
  }

  function avatar(name, color, cls) {
    const a = document.createElement('span');
    a.className = 'avatar' + (cls ? ' ' + cls : '');
    a.textContent = initials(name);
    a.style.background = color || 'var(--vscode-badge-background)';
    return a;
  }

  function setPeople(m) {
    connected = m.connected;
    users = m.users;
    document.body.classList.toggle('offline', !connected);
    $('stateText').textContent = !connected ? 'Chưa kết nối hub' : users.length ? users.length + ' người khác đang online' : 'Chỉ có bạn trong phòng';
    const faces = $('faces');
    faces.replaceChildren();
    for (const u of users.slice(0, 6)) {
      const b = document.createElement('button');
      b.className = 'face';
      b.title = u.name + (u.status ? ' — ' + u.status : '') + '\nBấm để nhắc tên';
      b.append(avatar(u.name, u.color));
      b.addEventListener('click', () => insert('@' + u.name + ' '));
      faces.append(b);
    }
    if (users.length > 6) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = '+' + (users.length - 6);
      more.title = users.slice(6).map((u) => u.name).join(', ');
      faces.append(more);
    }
    updateSend();
  }

  // ------------------------------------------------------------ message text

  const URL_RE = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/y;
  const REF_RE = /([A-Za-z0-9_\-.\/À-￿]+\.[A-Za-z0-9]+):(\d+)/y;
  const MENTION_RE = /@[\p{L}\p{N}_.\-]+/uy;
  const CODE_RE = /`([^`\n]+)`/y;
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;

  function link(text, title, onClick) {
    const a = document.createElement('a');
    a.textContent = text;
    a.title = title;
    a.href = '#';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return a;
  }

  // Inline formatting: `code`, URLs, file:line references and @mentions.
  function inline(el, text) {
    let plain = '';
    const flush = () => {
      if (plain) el.append(plain);
      plain = '';
    };
    for (let i = 0; i < text.length;) {
      let m;
      const ch = text[i];
      const atWordStart = i === 0 || /[\s([{>"',]/.test(text[i - 1]);
      if (ch === '`' && (CODE_RE.lastIndex = i, m = CODE_RE.exec(text))) {
        flush();
        const c = document.createElement('code');
        c.textContent = m[1];
        el.append(c);
      } else if (ch === 'h' && (URL_RE.lastIndex = i, m = URL_RE.exec(text))) {
        flush();
        const url = m[0];
        el.append(link(url, 'Mở ' + url + ' trong trình duyệt', () => vscode.postMessage({ type: 'openUrl', url })));
      } else if (ch === '@' && atWordStart && (MENTION_RE.lastIndex = i, m = MENTION_RE.exec(text))) {
        flush();
        const s = document.createElement('span');
        s.className = 'tag';
        s.textContent = m[0];
        el.append(s);
      } else if (atWordStart && (REF_RE.lastIndex = i, m = REF_RE.exec(text))) {
        flush();
        const rel = m[1];
        const line = Number(m[2]);
        el.append(link(m[0], 'Mở ' + m[0], () => vscode.postMessage({ type: 'open', rel, line })));
      } else {
        plain += ch;
        i += 1;
        continue;
      }
      i += m[0].length;
    }
    flush();
  }

  // ```fenced``` blocks become <pre>; everything else is inline text.
  function richText(el, text) {
    const parts = text.split(/```/);
    parts.forEach((part, k) => {
      if (k % 2 === 1 && k < parts.length - 1) {
        const pre = document.createElement('pre');
        pre.textContent = part.replace(/^[\w+-]*\n/, '').replace(/\n$/, '');
        el.append(pre);
      } else {
        inline(el, k % 2 === 1 ? '```' + part : part);
      }
    });
  }

  // ------------------------------------------------------------ images

  function loadImage(img, id) {
    const src = mediaSrc.get(id);
    if (src) {
      img.src = src;
      return;
    }
    const waiting = mediaWait.get(id);
    if (waiting) return waiting.push(img);
    mediaWait.set(id, [img]);
    vscode.postMessage({ type: 'media', id });
  }

  function imageBlock(image) {
    const box = document.createElement('button');
    box.className = 'shot loading';
    box.title = 'Mở ảnh (' + kb(image.size) + ')';
    if (image.w && image.h) box.style.aspectRatio = image.w + ' / ' + image.h;
    if (image.w) box.style.width = Math.min(image.w, 260) + 'px';
    const img = document.createElement('img');
    img.alt = 'Ảnh';
    img.addEventListener('load', () => box.classList.remove('loading'));
    box.append(img);
    box.addEventListener('click', () => vscode.postMessage({ type: 'openImage', id: image.id }));
    loadImage(img, image.id);
    return box;
  }

  function kb(n) {
    return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function readDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // Large photos and screenshots are scaled down before sending; small images and GIFs go as they are.
  async function prepare(file) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Chỉ gửi được ảnh PNG, JPEG, GIF hoặc WebP.');
    const bmp = await createImageBitmap(file);
    let { width: w, height: h } = bmp;
    let blob = file;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    if (file.type !== 'image/gif' && (scale < 1 || file.size > REENCODE_OVER)) {
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
      blob = file.type === 'image/png' ? await toBlob('image/png') : null;
      if (!blob || blob.size > REENCODE_OVER) blob = await toBlob('image/jpeg', 0.85);
    }
    bmp.close();
    if (blob.size > IMAGE_MAX) throw new Error('Ảnh lớn hơn 4 MB, không gửi được.');
    const src = await readDataUrl(blob);
    return { mime: blob.type || file.type, b64: src.slice(src.indexOf(',') + 1), w, h, src, size: blob.size };
  }

  async function attach(file) {
    try {
      attachment = await prepare(file);
    } catch (e) {
      notice(e && e.message ? e.message : 'Không đọc được ảnh.');
      return;
    }
    $('attachImg').src = attachment.src;
    $('attachInfo').textContent = attachment.w + '×' + attachment.h + ' · ' + kb(attachment.size);
    $('attach').classList.remove('hidden');
    updateSend();
    input.focus();
  }

  function clearAttachment() {
    attachment = null;
    $('attach').classList.add('hidden');
    $('attachImg').removeAttribute('src');
    updateSend();
  }

  // ------------------------------------------------------------ message list

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Hôm nay';
    if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';
    return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const hhmm = (ts) => new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const sender = (msg) => msg.fromKey || msg.fromId || msg.from;

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  }

  function add(msg) {
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    if (!last || new Date(last.ts).toDateString() !== new Date(msg.ts).toDateString()) {
      const day = document.createElement('div');
      day.className = 'day';
      day.textContent = dayLabel(msg.ts);
      log.append(day);
      last = null;
    }
    const cont = last && sender(last) === sender(msg) && msg.ts - last.ts < GROUP_MS;
    last = msg;

    const row = document.createElement('div');
    row.className = 'row' + (msg.mine ? ' mine' : '') + (cont ? ' cont' : '');
    if (!msg.mine) {
      if (cont) {
        const gap = document.createElement('span');
        gap.className = 'avatar-gap';
        row.append(gap);
      } else {
        row.append(avatar(msg.from, msg.color));
      }
    }
    const col = document.createElement('div');
    col.className = 'col';
    if (!cont) {
      const head = document.createElement('div');
      head.className = 'head';
      if (!msg.mine) {
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = msg.from;
        who.style.color = msg.color || '';
        if (msg.account) who.title = msg.account.provider + ': ' + msg.account.label;
        head.append(who);
      }
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = hhmm(msg.ts);
      head.append(time);
      col.append(head);
    }
    const text = msg.text || '';
    if (text) {
      const bubble = document.createElement('div');
      const big = text.length <= 32 && EMOJI_ONLY.test(text);
      bubble.className = 'bubble' + (big ? ' big' : '') + (msg.mention ? ' mention' : '');
      bubble.title = new Date(msg.ts).toLocaleString('vi-VN');
      richText(bubble, text);
      col.append(bubble);
    }
    if (msg.image && msg.image.id) col.append(imageBlock(msg.image));
    row.append(col);

    const stick = atBottom() || msg.mine;
    log.append(row);
    if (stick) scrollDown();
    else {
      unseen += 1;
      jump.textContent = unseen + ' tin mới ↓';
      jump.classList.remove('hidden');
    }
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
    unseen = 0;
    jump.classList.add('hidden');
  }

  function showEmpty() {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = connected ? 'Chưa có tin nhắn nào trong phòng.' : 'Kết nối hub để xem và gửi tin nhắn.';
    log.append(e);
  }

  log.addEventListener('scroll', () => {
    if (atBottom()) {
      unseen = 0;
      jump.classList.add('hidden');
    }
  });
  jump.addEventListener('click', scrollDown);

  // ------------------------------------------------------------ composer

  let noticeTimer = null;
  function notice(text) {
    const n = $('notice');
    n.textContent = text;
    n.classList.remove('hidden');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => n.classList.add('hidden'), 6000);
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }

  function updateSend() {
    const n = input.value.length;
    sendBtn.disabled = sending || !connected || (!input.value.trim() && !attachment);
    $('count').textContent = n > 3500 ? n + '/4000' : '';
  }

  function insert(text) {
    const s = input.selectionStart;
    input.value = input.value.slice(0, s) + text + input.value.slice(input.selectionEnd);
    input.selectionStart = input.selectionEnd = s + text.length;
    input.focus();
    changed();
  }

  function changed() {
    autosize();
    updateSend();
    save();
    suggest();
  }

  function send() {
    if (sendBtn.disabled) return;
    sending = true;
    updateSend();
    const image = attachment && { mime: attachment.mime, b64: attachment.b64, w: attachment.w, h: attachment.h };
    vscode.postMessage({ type: 'send', text: input.value.trim(), image });
  }

  // @-mention suggestions
  const suggestBox = $('suggest');
  let options = [];
  let active = 0;

  function mentionQuery() {
    const before = input.value.slice(0, input.selectionStart);
    const m = /(^|\s)@([\p{L}\p{N}_.\-]*)$/u.exec(before);
    return m ? { q: m[2].toLowerCase(), start: before.length - m[2].length - 1 } : null;
  }

  function suggest() {
    const mq = mentionQuery();
    const all = users.map((u) => ({ name: u.name, color: u.color })).concat([{ name: 'all', note: 'cả phòng' }]);
    options = mq ? all.filter((o) => o.name.toLowerCase().includes(mq.q)).slice(0, 8) : [];
    if (!options.length) return suggestBox.classList.add('hidden');
    active = Math.min(active, options.length - 1);
    suggestBox.replaceChildren();
    options.forEach((o, k) => {
      const item = document.createElement('div');
      item.className = 'opt' + (k === active ? ' active' : '');
      item.setAttribute('role', 'option');
      item.append(avatar(o.name, o.color, 'small'));
      const label = document.createElement('span');
      label.textContent = o.name;
      item.append(label);
      if (o.note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = o.note;
        item.append(note);
      }
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(k);
      });
      suggestBox.append(item);
    });
    suggestBox.classList.remove('hidden');
  }

  function pick(k) {
    const mq = mentionQuery();
    if (!mq) return;
    const name = options[k].name;
    const end = input.selectionStart;
    input.value = input.value.slice(0, mq.start) + '@' + name + ' ' + input.value.slice(end);
    input.selectionStart = input.selectionEnd = mq.start + name.length + 2;
    options = [];
    suggestBox.classList.add('hidden');
    changed();
  }

  input.addEventListener('keydown', (e) => {
    if (options.length && !suggestBox.classList.contains('hidden')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        return suggest();
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
        e.preventDefault();
        return pick(active);
      }
      if (e.key === 'Escape') {
        options = [];
        return suggestBox.classList.add('hidden');
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', changed);
  input.addEventListener('click', suggest);
  input.addEventListener('blur', () => setTimeout(() => suggestBox.classList.add('hidden'), 100));
  input.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    attach(item.getAsFile());
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer ? e.dataTransfer.files : [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    attach(file);
  });

  sendBtn.addEventListener('click', send);
  $('locBtn').addEventListener('click', () => vscode.postMessage({ type: 'location' }));
  $('imageBtn').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', () => {
    const f = $('file').files[0];
    $('file').value = '';
    if (f) attach(f);
  });
  $('attachRemove').addEventListener('click', clearAttachment);

  // emoji picker
  const emojiBox = $('emoji');
  let tab = recent.length ? -1 : 0;

  function renderEmoji() {
    const tabs = $('emojiTabs');
    tabs.replaceChildren();
    const tabList = [[-1, 'Gần đây']].concat(EMOJI.map((t, k) => [k, t[0]]));
    for (const [k, name] of tabList) {
      if (k === -1 && !recent.length) continue;
      const b = document.createElement('button');
      b.className = 'tab' + (k === tab ? ' active' : '');
      b.textContent = name;
      b.addEventListener('click', () => {
        tab = k;
        renderEmoji();
      });
      tabs.append(b);
    }
    const grid = $('emojiGrid');
    grid.replaceChildren();
    for (const em of tab === -1 ? recent : EMOJI[tab][1].split(' ')) {
      const b = document.createElement('button');
      b.className = 'em';
      b.textContent = em;
      b.addEventListener('click', (e) => {
        insert(em);
        recent = [em].concat(recent.filter((x) => x !== em)).slice(0, 24);
        save();
        if (!e.shiftKey) emojiBox.classList.add('hidden');
      });
      grid.append(b);
    }
  }

  $('emojiBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (emojiBox.classList.toggle('hidden')) return;
    renderEmoji();
  });
  document.addEventListener('click', (e) => {
    if (!emojiBox.contains(e.target)) emojiBox.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') emojiBox.classList.add('hidden');
  });

  // ------------------------------------------------------------ messages from the extension

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'init') {
      setPeople(m);
      log.replaceChildren();
      last = null;
      unseen = 0;
      for (const msg of m.messages) add(msg);
      if (!m.messages.length) showEmpty();
      scrollDown();
    } else if (m.type === 'people') {
      setPeople(m);
      if (log.querySelector('.empty')) {
        log.replaceChildren();
        showEmpty();
      }
    } else if (m.type === 'msg') {
      add(m.msg);
    } else if (m.type === 'insert') {
      insert(m.text);
    } else if (m.type === 'notice') {
      notice(m.text);
    } else if (m.type === 'sendResult') {
      sending = false;
      if (m.ok) {
        input.value = '';
        clearAttachment();
        changed();
      } else {
        notice(m.reason || 'Không gửi được tin nhắn.');
        updateSend();
      }
    } else if (m.type === 'media') {
      if (m.src) mediaSrc.set(m.id, m.src);
      for (const img of mediaWait.get(m.id) || []) {
        if (m.src) img.src = m.src;
        else {
          const box = img.parentElement;
          box.classList.remove('loading');
          box.classList.add('missing');
          box.title = '';
          box.textContent = 'Ảnh không còn trên hub';
        }
      }
      mediaWait.delete(m.id);
    }
  });

  autosize();
  updateSend();
  vscode.postMessage({ type: 'ready' });
})();
