// オンライン対戦用の共通部品。PeerJS でブラウザ同士を直接つなぐ(サーバーは PeerJS の無料の仲介だけ使う)
// 使い方(各ゲーム側):
//   Online.init({ game, names, getState, setState, turn })
//   クリック処理の最初で if (!Online.canAct()) return;
//   draw() の最後で Online.sync();
// 部屋を作った人が 0 番(先の色)、入った人が 1 番。
const Online = (() => {
  const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
  let cfg, peer, conn, last = '', code = '', status = '', applying = false;
  const api = { active: false, me: null };

  function load() {
    return new Promise((ok, ng) => {
      if (window.Peer) return ok();
      const s = document.createElement('script');
      s.src = PEERJS; s.onload = ok; s.onerror = () => ng(new Error('load'));
      document.head.appendChild(s);
    });
  }
  const peerId = c => `kokogr-${cfg.game}-${c}`.toLowerCase();
  const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

  function send() {
    if (!conn || !conn.open) return;
    last = JSON.stringify(cfg.getState());
    conn.send({ t: 'state', s: last });
  }

  function wire(c) {
    conn = c;
    conn.on('open', () => {
      if (conn !== c) return;
      api.active = true;
      if (cfg.onConnect) cfg.onConnect();
      set(`つながった。あなたは「${cfg.names[api.me]}」`);
      if (api.me === 0) send();
      refresh();
    });
    conn.on('data', d => {
      if (conn !== c) return;
      if (d.t === 'state' && d.s !== last) {
        last = d.s; applying = true;
        try { cfg.setState(JSON.parse(d.s)); } finally { applying = false; }
        refresh();
      }
    });
    conn.on('close', () => {
      if (conn !== c) return; set('相手との接続が切れた。相手が同じコードで入り直せば続きから遊べる(部屋を作った人がページを閉じたら作り直し)'); api.active = false; refresh(); });
    conn.on('error', () => set('通信エラー'));
  }

  async function host() {
    set('準備中…');
    try { await load(); } catch (e) { return set('部品を読み込めなかった。ネットにつながってるか確認して'); }
    code = newCode(); api.me = 0;
    peer = new Peer(peerId(code));
    peer.on('open', () => { set('友達を待ってる…'); refresh(); });
    // 入り直してきたときは古い接続を捨てて、新しい方をつなぐ
    peer.on('connection', c => { if (conn) conn.close(); wire(c); });
    peer.on('error', e => set(e.type === 'unavailable-id' ? 'そのコードは使われてる。もう一度「部屋を作る」を押して' : '接続できなかった(' + e.type + ')'));
  }

  async function join(c) {
    c = (c || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) return set('コードは4文字');
    set('つないでる…');
    try { await load(); } catch (e) { return set('部品を読み込めなかった。ネットにつながってるか確認して'); }
    code = c; api.me = 1;
    peer = new Peer();
    peer.on('open', () => {
      const x = peer.connect(peerId(c), { reliable: true });
      wire(x);
      setTimeout(() => { if (!api.active) set('つながらない。コードが合ってるか、相手が部屋を開いたままか確認して'); }, 10000);
    });
    peer.on('error', e => set(e.type === 'peer-unavailable' ? 'その部屋が見つからない。コードを確認して' : '接続できなかった(' + e.type + ')'));
  }

  // 画面上の小さなパネル
  // スマホで盤が下に押し出されないように、使うまでは1行に畳んでおく
  let box, opened = false;
  function set(t) { status = t; opened = true; refresh(); }
  function refresh() {
    if (!box) return;
    const link = code ? `${location.origin}${location.pathname}?room=${code}` : '';
    box.dataset.link = link;
    if (!opened) {
      box.style.borderStyle = 'none'; box.style.padding = '0';
      box.innerHTML = `<button class="btn" data-o="open" style="font-size:14px;padding:4px 14px">友達とオンラインで遊ぶ</button>`;
      return;
    }
    box.style.borderStyle = 'dashed'; box.style.padding = '10px 12px';
    if (api.active) {
      box.innerHTML = `<div class="note" style="margin:0"><b>オンライン中</b>　${status}</div>`;
      return;
    }
    let h;
    if (!peer) {
      h = `<button class="btn" data-o="host">部屋を作る</button>
        <input id="o-code" maxlength="4" placeholder="コード" style="width:6em;font:inherit;font-size:16px;padding:5px 8px;border-radius:8px;border:2px solid currentColor;background:transparent;color:inherit;text-transform:uppercase">
        <button class="btn" data-o="join">入る</button>`;
    } else if (api.me === 0 && !api.active) {
      h = `<span>部屋のコード <b style="font-size:22px;letter-spacing:.15em">${code}</b></span>
        <button class="btn" data-o="copy">招待リンクをコピー</button>`;
    } else h = '';
    box.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <b>オンライン</b>${h}</div>
      <div class="note" style="margin-top:4px">${status || '部屋を作ってコードを友達に送るか、もらったコードで入る。1台で遊ぶなら何もしなくていい。'}</div>`;
  }

  api.init = c => {
    cfg = c;
    box = document.createElement('div');
    box.style.cssText = 'margin:0 0 12px;padding:10px 12px;border-radius:12px;border:2px dashed currentColor;opacity:.95;font-size:15px';
    const top = document.querySelector('.top');
    top.after(box);
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-o]')?.dataset.o;
      if (a === 'open') { opened = true; refresh(); }
      if (a === 'host') host();
      if (a === 'join') join(document.getElementById('o-code').value);
      if (a === 'copy') {
        const t = box.dataset.link;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => set('リンクをコピーした。友達に送って'), () => set('このリンクを友達に送って: ' + t));
      }
    });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'o-code') join(e.target.value); });
    refresh();
    const q = new URLSearchParams(location.search).get('room');
    if (q) join(q);
  };

  // 今この端末で操作していいか。turn() が null なら誰でも操作できる
  api.canAct = () => {
    if (!api.active) return !peer || api.me === 0 && !conn; // 相手を待ってる間は1台モードのまま
    const t = cfg.turn();
    return t === null || t === api.me;
  };
  // 状態が変わっていたら相手に送る
  api.sync = () => {
    if (!api.active || applying) return;
    if (JSON.stringify(cfg.getState()) !== last) send();
  };
  api.isMine = p => !api.active || p === api.me;
  return api;
})();
