// 大人数で遊ぶゲーム用の部屋の仕組み(ito と同じ流れ: 部屋ID → 名前 → 待機室)
// 最初にその部屋IDに入った人がホストになって、ゲームの状態を全部持つ。
// ほかの人は「やりたいこと」をホストに送って、ホストから自分用の画面データをもらう。
//
// ゲーム側の使い方:
//   Room.init({
//     game: 'wordwolf', title: 'ワードウルフ', max: 10,
//     newState: () => ({...}),                   // ホストが最初に作る状態
//     onAction: (S, pid, a) => {},               // ホストの中で動く。S を書きかえる
//     view: (S, pid) => ({...}),                 // その人に見せていい分だけ返す
//     render: v => {},                           // v.players / v.me / v.hostId も入ってくる
//     onLeave: (S, pid) => {},                   // (なくてもいい)人が抜けたとき
//   });
//   Room.act({ ... })  … 自分の操作をホストに送る(ホストなら自分で処理)
const Room = (() => {
  const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
  const ICONS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🐮', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🐧'];
  const api = { roomId: '', me: '', isHost: false, joined: false };
  let cfg, peer, hostConn, conns = {}, S = null, players = [], app, msg = '', step = 'room';

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  api.esc = esc;
  const hostPeerId = () => `kokogr-${cfg.game}-${api.roomId}`;
  const store = {
    get: () => { try { return JSON.parse(sessionStorage.getItem('room-' + cfg.game)) || null; } catch (e) { return null; } },
    set: v => { try { sessionStorage.setItem('room-' + cfg.game, JSON.stringify(v)); } catch (e) {} },
    clear: () => { try { sessionStorage.removeItem('room-' + cfg.game); } catch (e) {} },
  };
  function loadPeer() {
    return new Promise((ok, ng) => {
      if (window.Peer) return ok();
      const s = document.createElement('script'); s.src = PEERJS; s.onload = ok; s.onerror = ng; document.head.appendChild(s);
    });
  }

  // ---------- 入るまでの画面 ----------
  function entrance() {
    const saved = (() => { try { return localStorage.getItem('room-name') || ''; } catch (e) { return ''; } })();
    let h = `<div class="screen"><h1>${esc(cfg.title)}</h1>`;
    if (step === 'room') {
      h += `<label>部屋ID (4桁)</label><input type="text" id="r-id" inputmode="numeric" maxlength="4" placeholder="新しく作るなら好きな4桁" value="${esc(api.roomId)}">` +
        `<button class="btn-primary" data-r="room">入室</button>`;
    } else if (step === 'name') {
      h += `<div class="info-box">部屋ID: <strong>${esc(api.roomId)}</strong></div>` +
        `<label>名前を入力</label><input type="text" id="r-name" maxlength="10" placeholder="あなたの名前" value="${esc(saved)}">` +
        `<button class="btn-primary" data-r="name">確定</button><button class="btn-secondary" data-r="back">部屋IDを入れ直す</button>`;
    } else {
      h += `<div class="wait-message">${esc(msg || 'つないでる…')}</div>`;
      if (step === 'error') h += `<button class="btn-secondary" data-r="back">はじめに戻る</button>`;
    }
    if (msg && step !== 'connecting' && step !== 'error') h += `<div class="info-box">${esc(msg)}</div>`;
    return h + `</div>`;
  }

  async function connect(name, pid) {
    step = 'connecting'; msg = 'つないでる…'; paint();
    try { await loadPeer(); } catch (e) { step = 'error'; msg = '部品を読み込めなかった。ネットにつながってるか確認して'; return paint(); }
    api.me = pid || 'p' + Math.random().toString(36).slice(2, 10);
    // まずホストになろうとする。その部屋IDがもう使われてたら、参加者として入る
    peer = new Peer(hostPeerId());
    peer.on('open', () => becomeHost(name));
    peer.on('error', e => {
      if (e.type === 'unavailable-id') { peer.destroy(); joinAsGuest(name); }
      else if (!api.joined) { step = 'error'; msg = 'つながらなかった(' + e.type + ')'; paint(); }
    });
  }

  // ---------- ホスト ----------
  function becomeHost(name) {
    api.isHost = true; api.joined = true;
    S = cfg.newState();
    players = [{ id: api.me, name, icon: ICONS[0], online: true }];
    store.set({ roomId: api.roomId, pid: api.me, name });
    peer.on('connection', c => {
      c.on('data', d => hostRecv(c, d));
      c.on('close', () => {
        const pid = Object.keys(conns).find(k => conns[k] === c);
        if (!pid) return;
        delete conns[pid];
        const p = players.find(p => p.id === pid); if (p) p.online = false;
        push();
      });
    });
    window.addEventListener('beforeunload', e => { if (players.length > 1) { e.preventDefault(); e.returnValue = ''; } });
    push();
  }

  function hostRecv(c, d) {
    if (d.t === 'join') {
      let p = players.find(p => p.id === d.pid);
      if (!p) {
        if (players.length >= (cfg.max || 10)) { c.send({ t: 'deny', why: '満員です' }); return; }
        if (cfg.canJoin && !cfg.canJoin(S)) { c.send({ t: 'deny', why: 'ゲーム中なので入れない。次のゲームまで待って' }); return; }
        const used = players.map(p => p.icon);
        p = { id: d.pid, name: String(d.name).slice(0, 10), icon: ICONS.find(i => !used.includes(i)) || '🙂', online: true };
        players.push(p);
      }
      p.online = true;
      if (conns[d.pid] && conns[d.pid] !== c) conns[d.pid].close();
      conns[d.pid] = c;
      return push();
    }
    const pid = Object.keys(conns).find(k => conns[k] === c);
    if (!pid) return;
    if (d.t === 'leave') { removePlayer(pid); c.close(); return; }
    if (d.t === 'act') { cfg.onAction(S, pid, d.a); push(); }
  }

  function removePlayer(pid) {
    players = players.filter(p => p.id !== pid);
    delete conns[pid];
    if (cfg.onLeave) cfg.onLeave(S, pid);
    push();
  }

  function viewFor(pid) {
    return { ...cfg.view(S, pid), players, me: pid, hostId: players[0]?.id, roomId: api.roomId };
  }
  // 全員に最新の画面データを送る
  function push() {
    for (const [pid, c] of Object.entries(conns)) if (c.open) c.send({ t: 'view', v: viewFor(pid) });
    render(viewFor(api.me));
  }

  // ---------- 参加者 ----------
  function joinAsGuest(name) {
    api.isHost = false;
    peer = new Peer();
    peer.on('open', () => {
      hostConn = peer.connect(hostPeerId(), { reliable: true });
      hostConn.on('open', () => hostConn.send({ t: 'join', pid: api.me, name }));
      hostConn.on('data', d => {
        if (d.t === 'view') {
          if (!api.joined) { api.joined = true; store.set({ roomId: api.roomId, pid: api.me, name }); }
          render(d.v);
        }
        if (d.t === 'deny') { step = 'error'; msg = d.why; store.clear(); paint(); }
        if (d.t === 'kicked') { store.clear(); alert('部屋から外された'); location.href = location.pathname; }
      });
      hostConn.on('close', () => {
        if (!api.joined) return;
        api.joined = false; step = 'error';
        msg = 'ホストとの接続が切れた。ホストが部屋を閉じたか、ネットが切れたかも。同じ部屋IDで入り直せば戻れることがある';
        paint();
      });
      setTimeout(() => { if (!api.joined && step === 'connecting') { step = 'error'; msg = 'つながらない。部屋IDを確認して、もう一度試して'; paint(); } }, 12000);
    });
    peer.on('error', e => {
      if (api.joined) return;
      step = 'error';
      msg = e.type === 'peer-unavailable' ? 'その部屋が見つからない。ホストがもう一度入り直すと直ることがある' : 'つながらなかった(' + e.type + ')';
      paint();
    });
  }

  // ---------- 共通 ----------
  let lastView = null;
  function render(v) {
    lastView = v;
    // 入力中の文字とカーソルを守る
    const vals = {}; app.querySelectorAll('input[id],textarea[id]').forEach(el => vals[el.id] = el.value);
    const focus = document.activeElement?.id;
    cfg.render(v);
    for (const [id, val] of Object.entries(vals)) { const el = document.getElementById(id); if (el && el.dataset.keep !== 'no' && !el.dataset.v) el.value = val; }
    const f = focus && document.getElementById(focus);
    if (f) { f.focus(); if (f.setSelectionRange && f.value && f.type !== 'number') f.setSelectionRange(f.value.length, f.value.length); }
    footer();
  }
  function paint() { app.innerHTML = entrance(); footer(); const i = app.querySelector('input'); if (i) i.focus(); }

  // ito と同じ、左下の「戻る」「抜ける」
  function footer() {
    let f = document.getElementById('r-foot');
    if (!f) { f = document.createElement('div'); f.id = 'r-foot'; document.body.appendChild(f); }
    f.innerHTML = api.joined ? `${api.isHost && cfg.onBack ? '<button class="fixed-back" data-r="toLobby" style="bottom:80px">← 待機室へ</button>' : ''}<button class="fixed-back" data-r="leave">抜ける</button>` : '';
  }

  api.act = a => {
    if (!api.joined) return;
    if (api.isHost) { cfg.onAction(S, api.me, a); push(); }
    else if (hostConn?.open) hostConn.send({ t: 'act', a });
  };
  api.kick = pid => {
    if (!api.isHost || pid === api.me) return;
    const p = players.find(p => p.id === pid);
    if (!confirm(`${p?.name} を追放する?`)) return;
    conns[pid]?.send({ t: 'kicked' });
    setTimeout(() => conns[pid]?.close(), 300);
    removePlayer(pid);
  };
  api.playersList = v => `<h2>参加者 (${v.players.length}人)</h2>` + v.players.map(p =>
    `<div class="player-item" ${v.me === v.hostId && p.id !== v.me ? `data-kick="${p.id}" title="押すと追放できる"` : ''}>` +
    `<div><span class="player-icon">${p.icon}</span><span>${esc(p.name)}</span>${p.id === v.hostId ? '<span class="host-badge">ホスト</span>' : ''}${p.id === v.me ? '<span class="host-badge" style="background:#cde">自分</span>' : ''}</div>` +
    `<div>${p.online ? '' : '<small>切断中</small>'}</div></div>`).join('');
  api.who = (v, pid) => { const p = v.players.find(p => p.id === pid); return p ? `${p.icon}${esc(p.name)}` : '(抜けた人)'; };

  api.init = c => {
    cfg = c;
    app = document.getElementById('app');
    app.addEventListener('click', e => {
      const k = e.target.closest('[data-kick]'); if (k) return api.kick(k.dataset.kick);
    });
    document.addEventListener('click', e => {
      const r = e.target.closest('[data-r]')?.dataset.r; if (!r) return;
      if (r === 'room') {
        const id = document.getElementById('r-id').value.trim();
        if (!/^\d{4}$/.test(id)) { msg = '4桁の数字を入れて'; return paint(); }
        api.roomId = id; step = 'name'; msg = ''; paint();
      }
      if (r === 'name') {
        const name = document.getElementById('r-name').value.trim();
        if (!name) { msg = '名前を入れて'; return paint(); }
        try { localStorage.setItem('room-name', name); } catch (e) {}
        connect(name);
      }
      if (r === 'back') { step = 'room'; msg = ''; if (peer) peer.destroy(); peer = null; paint(); }
      if (r === 'toLobby' && api.isHost && confirm('ゲームをやめて待機室に戻る?')) { cfg.onBack(S); push(); }
      if (r === 'leave') {
        if (!confirm(api.isHost ? 'ホストが抜けると部屋は解散する。いい?' : '部屋を抜ける?')) return;
        store.clear();
        if (!api.isHost && hostConn?.open) hostConn.send({ t: 'leave' });
        setTimeout(() => { location.href = location.pathname; }, 200);
      }
    });
    app.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'r-id') app.querySelector('[data-r=room]').click();
      if (e.target.id === 'r-name') app.querySelector('[data-r=name]').click();
    });
    // 再読み込みしたときは、同じ部屋に同じ人として入り直す
    const saved = store.get();
    const q = new URLSearchParams(location.search).get('room');
    if (saved && (!q || q === saved.roomId)) { api.roomId = saved.roomId; connect(saved.name, saved.pid); }
    else { if (q && /^\d{4}$/.test(q)) { api.roomId = q; step = 'name'; } paint(); }
  };
  api.view = () => lastView;
  api.players = () => players;
  return api;
})();
