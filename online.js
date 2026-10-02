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
    // スマホがスリープしたあとなどに仲介サーバーから切れたら、つなぎ直す(切れたままだと友達が入れない)
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
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
  let box;
  function set(t) { status = t; refresh(); }
  function refresh() {
    if (!box) return;
    const link = code ? `${location.origin}${location.pathname}?room=${code}` : '';
    let h;
    if (!peer) {
      h = `<button class="btn" data-o="host">部屋を作る</button>
        <span class="online-join"><input id="o-code" maxlength="4" placeholder="コード" autocomplete="off" aria-label="部屋のコード"><button class="btn" data-o="join">入る</button></span>`;
    } else if (api.me === 0 && !api.active) {
      h = `<span>部屋のコード <b class="online-code">${code}</b></span>
        <button class="btn" data-o="copy">招待リンクをコピー</button>`;
    } else h = '';
    box.className = 'online' + (api.active ? ' on' : '');
    box.innerHTML = `<div class="online-row"><b class="online-title">オンライン対戦</b>${h}</div>
      <div class="online-msg">${status || '別々の端末で遊ぶときだけ使う。1台で遊ぶなら何もしなくていい。'}</div>`;
    box.dataset.link = link;
  }

  api.init = c => {
    cfg = c;
    box = document.createElement('div');
    const top = document.querySelector('.top');
    top.after(box);
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-o]')?.dataset.o;
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
  // 「最初から」を押したとき。対戦の途中なら確認する(オンラインだと相手の画面もリセットされる)
  api.askReset = playing => !playing || confirm(api.active ? '最初からやり直す? 相手の画面もリセットされる' : '最初からやり直す?');
  return api;
})();
