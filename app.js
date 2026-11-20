/* Mevlana Stok — arayüz. Üç rol: şube, imalathane, yönetici. */
const $app = document.getElementById('app');
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const LABELS = [['0', 'Pzt'], ['00', 'Sal'], ['000', 'Çar'], ['0000', 'Per'], ['00000', 'Cum'], ['000000', 'Cmt'], ['0000000', 'Paz']];
const REASONS = ['Tarihi geçti', 'Düştü/ezildi', 'Bozuk geldi', 'Diğer'];

const S = { products: [], view: 'login', search: '', open: new Set(), tab: 'bugun' };

/* ---------- yardımcılar ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseNum = t => parseFloat(String(t).replace(/\./g, '').replace(',', '.')) || 0;
const num = n => (Math.round(n * 10) / 10).toLocaleString('tr-TR');
const tl = n => Math.round(n).toLocaleString('tr-TR') + ' ₺';
const trLower = s => String(s).toLocaleLowerCase('tr');
const P = id => S.products.find(p => p.id === +id);
const variantsOf = p => p.unit === 'Boy (0/1/2)' ? ['0', '1', '2'] : p.unit === 'Boy (0/1)' ? ['0', '1'] : null;
const stepOf = p => p.unit === 'Kg' ? 0.5 : 1;
const unitShort = p => p.unit.startsWith('Boy') ? 'adet' : p.unit.toLocaleLowerCase('tr');
const K = (pid, v) => v != null && v !== '' ? `${pid}#${v}` : `${pid}`;
const splitK = k => { const [p, v] = String(k).split('#'); return [+p, v ?? null]; };
const pname = (pid, v) => { const p = P(pid); return (p ? p.name : '#' + pid) + (v != null && v !== '' ? ` · Boy ${v}` : ''); };
// İş günü: Türkiye saatiyle gece 05:00'e kadar önceki gün
function bizDay(d = new Date()) {
  const tr = new Date(d.getTime() + 3 * 3600e3 - 5 * 3600e3);
  return tr.toISOString().slice(0, 10);
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
const labelOf = iso => { const d = dow(iso); return LABELS[(d + 6) % 7]; };
const trDate = iso => iso.split('-').reverse().join('.');
const hhmm = ts => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const dayTime = ts => new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Telefon hafızası dolu'); } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
function go(view) { S.view = view; S.search = ''; render(); window.scrollTo(0, 0); }

function header(title, back) {
  const s = API.session;
  const who = s ? `${esc(s.role === 'admin' ? 'Yönetici' : s.name)} · ${esc(s.worker)}` : '';
  return `<header class="top">
    ${back ? `<button class="icon-btn" data-act="back" aria-label="Geri">‹</button>` : `<img class="top-logo" src="logo.png" alt="">`}
    <div class="top-t"><b>${esc(title)}</b><small>${who}</small></div>
    ${s ? `<button class="out" data-act="logout">Çıkış</button>` : ''}
  </header>`;
}

/* ---------- ürün listesi + sayaç (şube sayımı, imalathane sevkiyatı) ---------- */
function counter(p, v, draft) {
  const k = K(p.id, v), val = draft[k];
  return `<div class="ctr ${val ? 'has' : ''}">
    ${v != null ? `<span class="boy">Boy ${v}</span>` : ''}
    <button class="cb minus" data-ctr="-1" data-k="${k}" aria-label="Azalt">−</button>
    <span class="cv" data-v="${k}">${val == null ? '–' : num(val)}</span>
    <button class="cb plus" data-ctr="1" data-k="${k}" aria-label="Artır">+</button>
  </div>`;
}
function productList(draft) {
  const q = trLower(S.search.trim()), groups = [];
  for (const p of S.products) {
    if (!p.active) continue;
    if (q && !trLower(p.name).includes(q) && !trLower(p.grp).includes(q)) continue;
    let g = groups.find(x => x.name === p.grp);
    if (!g) groups.push(g = { name: p.grp, items: [] });
    g.items.push(p);
  }
  if (!groups.length) return `<p class="empty">Ürün bulunamadı</p>`;
  return groups.map(g => {
    const isOpen = q || S.open.has(g.name);
    const filled = g.items.filter(p => (variantsOf(p) || [null]).some(v => draft[K(p.id, v)] != null)).length;
    return `<section class="grp ${isOpen ? 'open' : ''}">
      <button class="grp-h" data-grp="${esc(g.name)}"><span>${esc(g.name)}</span>
        <span class="badge">${filled ? filled + '/' : ''}${g.items.length}</span><i>▾</i></button>
      <div class="grp-b">${isOpen ? g.items.map(p => {
        const vs = variantsOf(p);
        return `<div class="row ${vs ? 'multi' : ''}">
          <div class="nm">${esc(p.name)}<small>${vs ? '' : esc(p.unit)}</small></div>
          ${(vs || [null]).map(v => counter(p, v, draft)).join('')}
        </div>`;
      }).join('') : ''}</div>
    </section>`;
  }).join('');
}
function bumpDraft(draft, k, dir, saveFn) {
  const [pid] = splitK(k), p = P(pid), st = stepOf(p);
  let next = Math.max(0, Math.round(((draft[k] ?? 0) + dir * st) * 10) / 10);
  draft[k] = next; saveFn();
  const el = document.querySelector(`.cv[data-v="${CSS.escape(k)}"]`);
  if (el) { el.textContent = num(next); el.closest('.ctr').classList.toggle('has', next > 0); }
  if (navigator.vibrate) navigator.vibrate(8);
}

/* ================= ŞUBE ================= */
const SB = {
  day: null, pending: [], doneToday: [],
  key() { return `mvs_draft_${API.session.account}_${bizDay()}`; },
  draft() { return store.get(this.key(), { kalan: {}, zayi: [] }); },
  save(d) { store.set(this.key(), d); },
  async load() {
    const [day, sh] = await Promise.all([API.myDay(), API.shipments()]);
    this.day = day;
    this.pending = sh.filter(s => s.status === 'bekliyor');
    this.doneToday = sh.filter(s => s.status !== 'bekliyor');
  }
};

function sbMenu() {
  const d = SB.day, n = SB.pending.length;
  return `${header('Ana Menü')}
  <main class="pad menu">
    ${d.submitted ? `<div class="note ok">Bugünkü sayım onaylandı ✓ (${esc(d.worker)}, ${hhmm(d.at)})</div>` : ''}
    <button class="big tile" data-go="sevk"><span class="em">📦</span>Gelen Sevkiyat
      ${n ? `<span class="pill">${n} bekliyor</span>` : `<small class="tile-s">Bekleyen yok</small>`}</button>
    <button class="big tile alt" data-go="sayim"><span class="em">🌙</span>Gün Sonu Sayım</button>
    <button class="big ghost" data-go="ozet">Özet ve Onay</button>
  </main>`;
}

function sbSevk() {
  const lab = labelOf(bizDay());
  const card = s => `<section class="card" data-sid="${s.id}">
      <div class="card-h"><b>${dayTime(s.sent_at)}</b><small>Gönderen: ${esc(s.sent_by)}</small></div>
      ${s.items.map(i => `<div class="row"><div class="nm">${esc(pname(i.product_id, i.variant))}
          <small>Gönderilen: ${num(i.qty_sent)} ${esc(unitShort(P(i.product_id) || { unit: 'Adet' }))}</small></div>
        <div class="ctr has"><button class="cb minus" data-rec="-1" data-i="${i.id}">−</button>
          <span class="cv" data-r="${i.id}">${num(i.qty_sent)}</span>
          <button class="cb plus" data-rec="1" data-i="${i.id}">+</button></div></div>`).join('')}
      <button class="big primary" data-act="confirm-sevk" data-id="${s.id}">Teslim aldım, onayla</button>
    </section>`;
  return `${header('Gelen Sevkiyat', true)}
  <main class="pad">
    <div class="note">Bugün gelenlere <b>${lab[0]}</b> (${lab[1]}) etiketi yapıştırın.</div>
    <p class="muted">Gelmeyen ya da eksik gelen varsa sayıyı düşürün, sonra onaylayın.</p>
    ${SB.pending.length ? SB.pending.map(card).join('') : `<p class="empty">Bekleyen sevkiyat yok</p>`}
    ${SB.doneToday.length ? `<h3 class="sec">Bugün teslim alınanlar</h3>${SB.doneToday.map(s => `<div class="note ${s.status === 'tamam' ? 'ok' : 'warn'}">
      ${hhmm(s.confirmed_at)} · ${esc(s.confirmed_by)} · ${s.status === 'tamam' ? 'Tam geldi ✓' : 'Eksik bildirildi'}</div>`).join('')}` : ''}
  </main>`;
}

function sbSayim() {
  if (SB.day.submitted) return `${header('Gün Sonu Sayım', true)}<main class="pad"><div class="note ok">Bugünün sayımı onaylandı, değiştirilemez.</div>
    <button class="big ghost" data-go="ozet">Özete git</button></main>`;
  const d = SB.draft();
  return `${header('Gün Sonu Sayım', true)}
  <div class="search"><input id="q" class="inp" type="search" placeholder="Ürün ara…" value="${esc(S.search)}" autocomplete="off"></div>
  <main class="list"><p class="muted hint">Raftaki kalanları sayın. Zayi (çöpe gidenler) ayrıca girilir.</p><div id="plist">${productList(d.kalan)}</div></main>
  <footer class="bar">
    <button class="big ghost" data-act="zayi">+ Zayi${d.zayi.length ? ` (${d.zayi.length})` : ''}</button>
    <button class="big primary" data-go="ozet">Özete geç</button>
  </footer>`;
}

function sbOzet() {
  const day = SB.day;
  if (day.submitted) {
    return `${header('Özet', true)}<main class="pad sum">
      <p class="muted">${trDate(day.day)} · ${esc(day.worker)} · ${hhmm(day.at)}</p>
      <div class="note ok">Onaylandı ✓ — kayıt kilitli.</div>
      <h3>Gün sonu kalan</h3>${day.counts.length ? `<ul class="ln">${day.counts.map(c => `<li><span>${esc(pname(c.product_id, c.variant))}</span><b>${num(c.qty)}</b></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
      <h3>Zayi</h3>${day.waste.length ? `<ul class="ln">${day.waste.map(w => `<li><span>${esc(pname(w.product_id, w.variant))}<small>${esc(w.label)} · ${esc(w.reason)}${w.note ? ' · ' + esc(w.note) : ''}</small></span><b>${num(w.qty)}</b></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
      ${day.corrections.length ? `<h3>Düzeltme talepleri</h3><ul class="ln">${day.corrections.map(c => `<li><span>${esc(c.body)}<small>${hhmm(c.at)}</small></span><b>${c.status === 'bekliyor' ? '⏳' : '✓'}</b></li>`).join('')}</ul>` : ''}
      <button class="big ghost" data-act="corr">Düzeltme talebi gönder</button>
    </main>`;
  }
  const d = SB.draft();
  const counts = Object.entries(d.kalan).filter(([, q]) => q > 0);
  const untouched = S.products.filter(p => p.active && !(variantsOf(p) || [null]).some(v => d.kalan[K(p.id, v)] != null)).length;
  return `${header('Özet ve Onay', true)}
  <main class="pad sum">
    <p class="muted">Bugün girdiklerin · ${trDate(bizDay())}</p>
    <h3>Gün sonu kalan</h3>${counts.length ? `<ul class="ln">${counts.map(([k, q]) => { const [p, v] = splitK(k); return `<li><span>${esc(pname(p, v))}</span><b>${num(q)}</b></li>`; }).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
    <h3>Zayi</h3>${d.zayi.length ? `<ul class="ln">${d.zayi.map((z, i) => `<li><span>${esc(pname(z.product_id, z.variant))}<small>${esc(z.label)} · ${esc(z.reason)}${z.note ? ' · ' + esc(z.note) : ''}</small></span>
      <b>${num(z.qty)}</b>${z.photo ? `<img src="${z.photo}" alt="">` : ''}<button class="x" data-delz="${i}" aria-label="Sil">✕</button></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
    ${SB.pending.length ? `<div class="note warn">Teslim alınmamış ${SB.pending.length} sevkiyat var. Önce onları onaylayın.</div>` : ''}
    ${untouched ? `<div class="note">Hiç dokunmadığın ${untouched} ürün <b>0 (rafta yok)</b> sayılacak.</div>` : ''}
    <button class="big primary" data-act="submit">Onayla ve gönder</button>
    <p class="muted center">Onaydan sonra değiştirilemez.</p>
  </main>`;
}

function openZayi() {
  const z = { product_id: null, variant: null, qty: 1, label: labelOf(addDays(bizDay(), -1))[0], reason: '', note: '', photo: null, q: '' };
  const m = document.createElement('div'); m.className = 'modal';
  const draw = () => {
    const p = z.product_id ? P(z.product_id) : null, vs = p && variantsOf(p);
    m.innerHTML = `<div class="sheet">
      <div class="sh-h"><b>Zayi Ekle</b><button class="icon-btn dark" data-z="close">✕</button></div>
      <label>Ürün</label>
      <input id="zq" class="inp" placeholder="Ürün ara…" autocomplete="off" value="${esc(p ? p.name : z.q)}">
      <div id="zres" class="zres"></div>
      ${vs ? `<label>Boy</label><div class="chips">${vs.map(v => `<button class="chip ${z.variant === v ? 'on' : ''}" data-z="var" data-v="${v}">Boy ${v}</button>`).join('')}</div>` : ''}
      <label>Miktar${p ? ` (${esc(unitShort(p))})` : ''}</label>
      <div class="ctr big-ctr"><button class="cb minus" data-z="m">−</button><span class="cv">${num(z.qty)}</span><button class="cb plus" data-z="p">+</button></div>
      <label>Etiket (kaç sıfır?)</label>
      <div class="chips">${LABELS.map(([c, d]) => `<button class="chip ${z.label === c ? 'on' : ''}" data-z="lab" data-v="${c}">${c} <small>${d}</small></button>`).join('')}</div>
      <label>Neden</label>
      <div class="chips">${REASONS.map(r => `<button class="chip ${z.reason === r ? 'on' : ''}" data-z="rea" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      ${z.reason === 'Diğer' ? `<input id="zn" class="inp" placeholder="Açıklama" value="${esc(z.note)}">` : ''}
      <label>Fotoğraf (isteğe bağlı)</label>
      <div class="photo">${z.photo ? `<img src="${z.photo}" alt=""><button class="chip" data-z="nophoto">Kaldır</button>` : `<label class="chip file">📷 Fotoğraf çek<input id="zf" type="file" accept="image/*" capture="environment" hidden></label>`}</div>
      <p class="err" id="zerr"></p>
      <button class="big primary" data-z="save">Zayiye ekle</button>
    </div>`;
    const input = m.querySelector('#zq'), box = m.querySelector('#zres');
    const list = () => {
      const q = trLower(input.value.trim());
      if (!q || (p && p.name === input.value)) { box.innerHTML = ''; return; }
      box.innerHTML = S.products.filter(x => x.active && (trLower(x.name).includes(q) || trLower(x.grp).includes(q))).slice(0, 7)
        .map(x => `<button class="res" data-z="pick" data-id="${x.id}">${esc(x.name)}<small>${esc(x.grp)}</small></button>`).join('');
    };
    input.oninput = () => { z.q = input.value; z.product_id = null; z.variant = null; list(); };
    list();
  };
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-z]');
    if (!b) { if (e.target === m) m.remove(); return; }
    const a = b.dataset.z, val = b.dataset.v, n = m.querySelector('#zn'); if (n) z.note = n.value;
    if (a === 'close') return m.remove();
    if (a === 'pick') { z.product_id = +b.dataset.id; z.variant = null; z.qty = stepOf(P(z.product_id)) === 0.5 ? 0.5 : 1; }
    if (a === 'var') z.variant = val;
    if (a === 'lab') z.label = val;
    if (a === 'rea') z.reason = val;
    if (a === 'm' || a === 'p') { const st = z.product_id ? stepOf(P(z.product_id)) : 1; z.qty = Math.max(st, Math.round((z.qty + (a === 'p' ? st : -st)) * 10) / 10); }
    if (a === 'nophoto') z.photo = null;
    if (a === 'save') {
      const p = z.product_id && P(z.product_id), err = m.querySelector('#zerr');
      const bad = !p ? 'Ürün seçin' : (variantsOf(p) && z.variant == null) ? 'Boy seçin' : !z.reason ? 'Neden seçin' : '';
      if (bad) { err.textContent = bad; return; }
      const d = SB.draft();
      d.zayi.push({ product_id: z.product_id, variant: z.variant, qty: z.qty, label: z.label, reason: z.reason, note: z.note, photo: z.photo });
      SB.save(d); m.remove(); toast('Zayi eklendi'); render(); return;
    }
    draw();
  });
  m.addEventListener('change', async e => {
    if (e.target.id !== 'zf' || !e.target.files[0]) return;
    z.photo = await shrink(e.target.files[0]); draw();
  });
  document.body.appendChild(m); draw();
}
function shrink(file) {
  return new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, 640 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => res(null);
    img.src = url;
  });
}

/* ================= İMALATHANE ================= */
const IM = { branch: null, list: [], drafts: {} };
const branches = () => (S.accounts || []).filter(a => a.role === 'sube');
function imMenu() {
  return `${header('İmalathane')}
  <main class="pad menu">
    <button class="big tile" data-go="im-yeni"><span class="em">🚚</span>Yeni Sevkiyat</button>
    <button class="big ghost" data-go="im-liste">Gönderilenler (son 7 gün)</button>
  </main>`;
}
function imYeni() {
  if (!IM.branch) {
    return `${header('Yeni Sevkiyat', true)}<main class="pad"><label>Hangi şubeye?</label>
      <div class="col">${branches().map(b => `<button class="big ghost" data-imb="${b.id}">${esc(b.name)}</button>`).join('')}</div></main>`;
  }
  const d = IM.drafts[IM.branch] || (IM.drafts[IM.branch] = {});
  const n = Object.values(d).filter(q => q > 0).length;
  const bn = branches().find(b => b.id === IM.branch);
  return `${header('→ ' + (bn ? bn.name : ''), true)}
  <div class="search"><input id="q" class="inp" type="search" placeholder="Ürün ara…" value="${esc(S.search)}" autocomplete="off"></div>
  <main class="list"><div id="plist">${productList(d)}</div></main>
  <footer class="bar">
    <button class="big ghost" data-act="im-sube">Şube değiştir</button>
    <button class="big primary" data-act="im-send">Gönder${n ? ` (${n})` : ''}</button>
  </footer>`;
}
function imListe() {
  const st = { bekliyor: '⏳ Teslim bekliyor', tamam: '✓ Tam teslim alındı', eksik: '⚠ Eksik bildirildi' };
  return `${header('Gönderilenler', true)}<main class="pad">
    ${IM.list.length ? IM.list.map(s => `<section class="card"><div class="card-h"><b>${esc(s.branch_name)}</b><small>${dayTime(s.sent_at)} · ${esc(s.sent_by)}</small></div>
      <div class="note ${s.status === 'tamam' ? 'ok' : s.status === 'eksik' ? 'warn' : ''}">${st[s.status]}${s.confirmed_by ? ` · ${esc(s.confirmed_by)} ${dayTime(s.confirmed_at)}` : ''}</div>
      <ul class="ln">${s.items.map(i => `<li><span>${esc(pname(i.product_id, i.variant))}</span><b>${num(i.qty_sent)}${i.qty_received != null && +i.qty_received !== +i.qty_sent ? ` → ${num(i.qty_received)}` : ''}</b></li>`).join('')}</ul></section>`).join('')
      : '<p class="empty">Son 7 günde gönderim yok</p>'}
  </main>`;
}

/* ================= YÖNETİCİ ================= */
const AD = { data: null, range: '7', branch: 'all', detBranch: null, detDay: null, loadedFor: null, pq: '' };
function rangeDates(r) {
  const today = bizDay();
  if (r === '1') return [today, today];
  if (r === 'dun') { const y = addDays(today, -1); return [y, y]; }
  if (r === '7') return [addDays(today, -6), today];
  if (r === '30') return [addDays(today, -29), today];
  if (r === 'ay') return [today.slice(0, 8) + '01', today];
  if (r === 'gecenay') { const f = addDays(today.slice(0, 8) + '01', -1); return [f.slice(0, 8) + '01', f]; }
  return [addDays(today, -6), today];
}
async function adLoad(force) {
  const today = bizDay(), [f] = rangeDates(AD.range);
  let from = addDays(today, -6);
  if (f < from) from = f;
  if (AD.detDay && AD.detDay < from) from = AD.detDay;
  const key = from + '_' + today;
  if (!force && AD.data && AD.loadedFor && AD.loadedFor.split('_')[0] <= from && Date.now() - AD.at < 60000) return;
  AD.data = await API.adminData(from, today);
  AD.loadedFor = key; AD.at = Date.now();
}
const priceOf = (pid, v) => { const p = P(pid); if (!p || !p.prices) return 0; return +(p.prices[v ?? ''] ?? p.prices[''] ?? 0) || 0; };

// Satış hesabı: önceki sayım + gelen − bugünkü kalan − zayi
function computeDays(data) {
  const out = []; // {branch, day, worker, at, sold:{k:q}, waste:{k:q}, rec:{k:q}, kalan:{k:q}, base:boolean}
  const subsBy = {};
  for (const s of data.submissions) (subsBy[s.branch] ||= []).push(s);
  const countsBy = {}, wasteBy = {};
  for (const c of data.counts) ((countsBy[c.sid] ||= {})[K(c.p, c.v)] = +c.q);
  for (const w of data.waste) { const m = (wasteBy[w.sid] ||= {}); const k = K(w.p, w.v); m[k] = (m[k] || 0) + +w.q; }
  for (const [b, subs] of Object.entries(subsBy)) {
    subs.sort((a, c) => a.day < c.day ? -1 : 1);
    subs.forEach((s, i) => {
      const prev = subs[i - 1];
      const rec = {};
      for (const sh of data.shipments) {
        if (sh.branch !== b || sh.status === 'bekliyor' || !sh.day) continue;
        if (sh.day > s.day || (prev ? sh.day <= prev.day : sh.day < s.day)) continue;
        for (const it of sh.items) { const k = K(it.p, it.v); rec[k] = (rec[k] || 0) + +(it.rec ?? it.sent); }
      }
      const kalan = countsBy[s.id] || {}, waste = wasteBy[s.id] || {}, sold = {}, avail = {};
      if (prev) {
        const open = countsBy[prev.id] || {};
        const keys = new Set([...Object.keys(open), ...Object.keys(rec), ...Object.keys(kalan), ...Object.keys(waste)]);
        for (const k of keys) {
          avail[k] = (open[k] || 0) + (rec[k] || 0);
          const q = avail[k] - (kalan[k] || 0) - (waste[k] || 0);
          if (q > 0) sold[k] = Math.round(q * 10) / 10;
        }
      }
      out.push({ branch: b, day: s.day, worker: s.worker, at: s.at, sid: s.id, sold, waste, rec, kalan, avail, base: !prev });
    });
  }
  return out;
}
function aggregate(days, from, to, branch) {
  const sel = days.filter(d => d.day >= from && d.day <= to && (branch === 'all' || d.branch === branch));
  const prod = {}, byDay = {}, byDow = [0, 0, 0, 0, 0, 0, 0], dowN = [0, 0, 0, 0, 0, 0, 0];
  let soldTL = 0, wasteTL = 0, soldQ = 0, wasteQ = 0, recTL = 0;
  for (const d of sel) {
    let dayTL = 0;
    for (const [k, q] of Object.entries(d.sold)) { const [p, v] = splitK(k); const t = q * priceOf(p, v); (prod[k] ||= { s: 0, w: 0, st: 0, wt: 0, r: 0, a: 0 }).s += q; prod[k].st += t; soldTL += t; soldQ += q; dayTL += t; }
    for (const [k, q] of Object.entries(d.waste)) { const [p, v] = splitK(k); const t = q * priceOf(p, v); (prod[k] ||= { s: 0, w: 0, st: 0, wt: 0, r: 0, a: 0 }).w += q; prod[k].wt += t; wasteTL += t; wasteQ += q; }
    for (const [k, q] of Object.entries(d.rec)) { const [p, v] = splitK(k); (prod[k] ||= { s: 0, w: 0, st: 0, wt: 0, r: 0, a: 0 }).r += q; recTL += q * priceOf(p, v); }
    for (const [k, q] of Object.entries(d.avail)) (prod[k] ||= { s: 0, w: 0, st: 0, wt: 0, r: 0, a: 0 }).a += q;
    if (!d.base) { byDay[d.day] = (byDay[d.day] || 0) + dayTL; }
  }
  for (const [day, t] of Object.entries(byDay)) { byDow[dow(day)] += t; dowN[dow(day)]++; }
  return { sel, prod, byDay, byDow: byDow.map((t, i) => dowN[i] ? t / dowN[i] : 0), soldTL, wasteTL, soldQ, wasteQ, recTL };
}
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;
function bars(entries, fmt) {
  const max = Math.max(1, ...entries.map(e => e[1]));
  return `<div class="bars">${entries.map(([l, v]) => `<div class="bar-r"><span class="bl">${esc(l)}</span><span class="bt"><i style="width:${Math.max(2, v / max * 100)}%"></i></span><span class="bv">${fmt(v)}</span></div>`).join('')}</div>`;
}
const tabs = () => `<nav class="tabs">${[['bugun', '📊', 'Bugün'], ['rapor', '📈', 'Rapor'], ['detay', '🏪', 'Şubeler'], ['talep', '🔔', 'Talepler'], ['ayar', '⚙️', 'Ayarlar']]
  .map(([id, ic, t]) => `<button class="${S.tab === id ? 'on' : ''}" data-tab="${id}"><span>${ic}</span>${t}${id === 'talep' && adAlerts() ? `<em>${adAlerts()}</em>` : ''}</button>`).join('')}</nav>`;
function adAlerts() {
  if (!AD.data) return 0;
  return AD.data.corrections.filter(c => c.status === 'bekliyor').length
    + AD.data.shipments.filter(s => s.status === 'eksik' && !store.get('mvs_seen_eksik', []).includes(s.id)).length;
}

function adBugun() {
  const today = bizDay(), days = computeDays(AD.data);
  const ag = aggregate(days, today, today, 'all');
  const bs = branches();
  return `${header('Yönetici · ' + trDate(today))}<main class="pad admin">
    <div class="kpis">
      <div class="kpi"><small>Bugünkü satış</small><b>${tl(ag.soldTL)}</b></div>
      <div class="kpi red"><small>Bugünkü zayi</small><b>${tl(ag.wasteTL)}</b></div>
    </div>
    ${bs.map(b => {
      const d = ag.sel.find(x => x.branch === b.id);
      const pend = AD.data.shipments.filter(s => s.branch === b.id && s.status === 'bekliyor').length;
      const a1 = aggregate(days, today, today, b.id);
      return `<section class="card bcard" data-det="${b.id}">
        <div class="card-h"><b>${esc(b.name)}</b>${d ? `<span class="ok-t">✓ ${esc(d.worker)} ${hhmm(d.at)}</span>` : `<span class="no-t">Sayım girilmedi</span>`}</div>
        <div class="mini">
          <span>Satış<b>${d && !d.base ? tl(a1.soldTL) : '–'}</b></span>
          <span>Zayi<b>${d ? tl(a1.wasteTL) : '–'}</b></span>
          <span>Sevkiyat<b>${pend ? `<i class="warn-t">${pend} bekliyor</i>` : 'Bekleyen yok'}</b></span>
        </div>
        ${d && d.base ? `<small class="muted">İlk sayım: satış yarından itibaren hesaplanır.</small>` : ''}
      </section>`;
    }).join('')}
    <button class="big ghost" data-act="ad-refresh">↻ Yenile</button>
  </main>${tabs()}`;
}

function adRapor() {
  const [from, to] = rangeDates(AD.range);
  const ag = aggregate(computeDays(AD.data), from, to, AD.branch);
  const rows = Object.entries(ag.prod).map(([k, v]) => ({ k, ...v }));
  const top = rows.filter(r => r.s > 0).sort((a, b) => b.st - a.st).slice(0, 10);
  const low = rows.filter(r => r.a > 0).sort((a, b) => (a.s / a.a) - (b.s / b.a)).slice(0, 10);
  const waste = rows.filter(r => r.w > 0).sort((a, b) => b.wt - a.wt).slice(0, 10);
  const reasons = {};
  for (const d of ag.sel) for (const w of AD.data.waste.filter(w => w.sid === d.sid)) reasons[w.reason] = (reasons[w.reason] || 0) + +w.q * priceOf(w.p, w.v);
  const R = [['1', 'Bugün'], ['dun', 'Dün'], ['7', '7 gün'], ['30', '30 gün'], ['ay', 'Bu ay'], ['gecenay', 'Geçen ay']];
  return `${header('Raporlar')}<main class="pad admin">
    <div class="chips sm">${R.map(([id, t]) => `<button class="chip ${AD.range === id ? 'on' : ''}" data-range="${id}">${t}</button>`).join('')}</div>
    <div class="chips sm">${[['all', 'Tüm şubeler'], ...branches().map(b => [b.id, b.name])].map(([id, t]) => `<button class="chip ${AD.branch === id ? 'on' : ''}" data-br="${id}">${esc(t)}</button>`).join('')}</div>
    <p class="muted">${trDate(from)} – ${trDate(to)}</p>
    <div class="kpis">
      <div class="kpi"><small>Satış</small><b>${tl(ag.soldTL)}</b><small>${num(ag.soldQ)} birim</small></div>
      <div class="kpi red"><small>Zayi</small><b>${tl(ag.wasteTL)}</b><small>Gelenin %${pct(ag.wasteTL, ag.recTL)}'i</small></div>
    </div>
    <h3 class="sec">En çok satanlar</h3>${top.length ? bars(top.map(r => [pname(...splitK(r.k)), r.st]), tl) : '<p class="empty small">Veri yok</p>'}
    <h3 class="sec">En az satanlar <small>(raftakinin yüzde kaçı satıldı)</small></h3>${low.length ? bars(low.map(r => [pname(...splitK(r.k)), pct(r.s, r.a)]), v => '%' + v) : '<p class="empty small">Veri yok</p>'}
    <h3 class="sec">En çok zayi olanlar</h3>${waste.length ? bars(waste.map(r => [pname(...splitK(r.k)), r.wt]), tl) : '<p class="empty small">Zayi yok</p>'}
    ${Object.keys(reasons).length ? `<h3 class="sec">Zayi nedenleri</h3>${bars(Object.entries(reasons), tl)}` : ''}
    <h3 class="sec">Ürün bazında kazanç <small>(satış − zayi kaybı)</small></h3>
    ${(() => { const all = rows.filter(r => r.s > 0 || r.w > 0).sort((a, b) => (b.st - b.wt) - (a.st - a.wt));
      if (!all.length) return '<p class="empty small">Veri yok</p>';
      const tr = r => `<tr><td>${esc(pname(...splitK(r.k)))}</td><td>${num(r.s)}</td><td>${tl(r.st)}</td><td class="neg">${r.wt ? '−' + tl(r.wt) : '–'}</td><td><b>${tl(r.st - r.wt)}</b></td></tr>`;
      const noPrice = all.filter(r => !priceOf(...splitK(r.k))).length;
      return `<div class="tbl"><table><thead><tr><th>Ürün</th><th>Satılan</th><th>Satış</th><th>Zayi</th><th>Net</th></tr></thead>
        <tbody>${all.slice(0, 15).map(tr).join('')}</tbody></table></div>
        ${all.length > 15 ? `<details><summary class="chip">Tüm ürünler (${all.length})</summary><div class="tbl"><table><tbody>${all.slice(15).map(tr).join('')}</tbody></table></div></details>` : ''}
        ${noPrice ? `<p class="muted">${noPrice} ürünün fiyatı girilmemiş, onlar 0 ₺ görünür. Ayarlar'dan ekleyebilirsin.</p>` : ''}`; })()}
    <h3 class="sec">Haftanın günlerine göre ortalama satış</h3>${bars([1, 2, 3, 4, 5, 6, 0].map(i => [DAYS[i], ag.byDow[i]]), tl)}
    <h3 class="sec">Günlük satış</h3>${Object.keys(ag.byDay).length ? bars(Object.entries(ag.byDay).sort().map(([d, v]) => [trDate(d).slice(0, 5) + ' ' + DAYS[dow(d)], v]), tl) : '<p class="empty small">Satış hesabı için en az iki günlük sayım gerekir.</p>'}
  </main>${tabs()}`;
}

function adDetay() {
  const b = AD.detBranch || branches()[0]?.id, day = AD.detDay || bizDay();
  const days = computeDays(AD.data), d = days.find(x => x.branch === b && x.day === day);
  const sh = AD.data.shipments.filter(s => s.branch === b && (s.day === day || (s.status === 'bekliyor' && day === bizDay())));
  const wl = d ? AD.data.waste.filter(w => w.sid === d.sid) : [];
  const list = (obj, f) => { const e = Object.entries(obj).filter(([, q]) => q > 0); return e.length ? `<ul class="ln">${e.map(([k, q]) => `<li><span>${esc(pname(...splitK(k)))}</span><b>${num(q)}</b>${f ? `<small class="r">${tl(q * priceOf(...splitK(k)))}</small>` : ''}</li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'; };
  return `${header('Şube Detayı')}<main class="pad admin">
    <div class="chips sm">${branches().map(x => `<button class="chip ${x.id === b ? 'on' : ''}" data-detb="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="daynav"><button class="chip" data-dday="-1">‹ Önceki</button><input type="date" id="dday" class="inp" value="${day}" max="${bizDay()}"><button class="chip" data-dday="1" ${day >= bizDay() ? 'disabled' : ''}>Sonraki ›</button></div>
    ${d ? `<div class="note ok">Sayım: ${esc(d.worker)} · ${hhmm(d.at)}</div>` : `<div class="note warn">Bu gün sayım girilmemiş.</div>`}
    <h3 class="sec">Satılan (hesaplanan)</h3>${d && !d.base ? list(d.sold, true) : '<p class="empty small">Hesaplanamıyor (önceki gün sayımı yok)</p>'}
    <h3 class="sec">Gün sonu kalan</h3>${d ? list(d.kalan) : '<p class="empty small">–</p>'}
    <h3 class="sec">Zayi</h3>${wl.length ? `<ul class="ln">${wl.map(w => `<li><span>${esc(pname(w.p, w.v))}<small>${esc(w.label || '')} · ${esc(w.reason || '')}${w.note ? ' · ' + esc(w.note) : ''}</small></span><b>${num(w.q)}</b>${w.photo ? `<button class="chip" data-photo="${w.id}">📷</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty small">Zayi yok</p>'}
    <h3 class="sec">Sevkiyatlar</h3>${sh.length ? sh.map(s => `<section class="card"><div class="card-h"><b>${dayTime(s.sent_at)}</b><small>${esc(s.sent_by)} → ${s.status === 'bekliyor' ? 'teslim bekliyor' : esc(s.confirmed_by) + ' ' + hhmm(s.confirmed_at)}</small></div>
      <ul class="ln">${s.items.map(i => `<li><span>${esc(pname(i.p, i.v))}</span><b>${num(i.sent)}${i.rec != null && +i.rec !== +i.sent ? ` <i class="warn-t">→ ${num(i.rec)}</i>` : ''}</b></li>`).join('')}</ul></section>`).join('') : '<p class="empty small">Sevkiyat yok</p>'}
  </main>${tabs()}`;
}

function adTalep() {
  const cs = AD.data.corrections, eks = AD.data.shipments.filter(s => s.status === 'eksik').sort((a, b) => a.confirmed_at < b.confirmed_at ? 1 : -1);
  const seen = store.get('mvs_seen_eksik', []);
  const bn = id => (S.accounts.find(a => a.id === id) || {}).name || id;
  return `${header('Talepler')}<main class="pad admin">
    <h3 class="sec">Düzeltme talepleri</h3>
    ${cs.length ? cs.map(c => `<section class="card"><div class="card-h"><b>${esc(bn(c.branch))}</b><small>${esc(c.worker)} · ${dayTime(c.at)}</small></div>
      <p>${esc(c.body)}</p>
      ${c.status === 'bekliyor' ? `<div class="row2"><button class="big ghost" data-corr="${c.id}" data-st="reddedildi">Reddet</button><button class="big primary" data-corr="${c.id}" data-st="yapildi">Tamam</button></div>`
        : `<div class="note ${c.status === 'yapildi' ? 'ok' : ''}">${c.status === 'yapildi' ? 'Tamamlandı' : 'Reddedildi'}</div>`}</section>`).join('') : '<p class="empty small">Talep yok</p>'}
    <h3 class="sec">Eksik gelen sevkiyatlar</h3>
    ${eks.length ? eks.map(s => `<section class="card ${seen.includes(s.id) ? '' : 'new'}"><div class="card-h"><b>${esc(bn(s.branch))}</b><small>${dayTime(s.confirmed_at)} · ${esc(s.confirmed_by)}</small></div>
      <ul class="ln">${s.items.filter(i => +i.rec < +i.sent).map(i => `<li><span>${esc(pname(i.p, i.v))}</span><b>${num(i.sent)} gönderildi → ${num(i.rec)} geldi</b></li>`).join('')}</ul>
      ${seen.includes(s.id) ? '' : `<button class="big ghost" data-seen="${s.id}">Gördüm</button>`}</section>`).join('') : '<p class="empty small">Eksik sevkiyat yok</p>'}
  </main>${tabs()}`;
}

function adAyar() {
  const q = trLower(AD.pq.trim());
  const ps = S.products.filter(p => !q || trLower(p.name).includes(q) || trLower(p.grp).includes(q));
  return `${header('Ayarlar')}<main class="pad admin">
    <h3 class="sec">PIN'ler</h3>
    <ul class="ln">${S.accounts.map(a => `<li><span>${esc(a.role === 'admin' ? 'Yönetici (' + a.name + ')' : a.name)}</span><button class="chip" data-pin="${a.id}">PIN değiştir</button></li>`).join('')}</ul>
    <h3 class="sec">Ürünler, fiyatlar ve raf ömrü</h3>
    <input id="pq" class="inp" type="search" placeholder="Ürün ara…" value="${esc(AD.pq)}">
    <div id="plist2">${ps.map(p => {
      const vs = variantsOf(p) || [''];
      return `<div class="prow ${p.active ? '' : 'off'}" data-pid="${p.id}">
        <div class="nm">${esc(p.name)}<small>${esc(p.grp)} · ${esc(p.unit)}${p.note ? ' · ' + esc(p.note) : ''}</small></div>
        <div class="pf">${vs.map(v => `<label class="mini-l">${v === '' ? 'Fiyat ₺' : 'Boy ' + v + ' ₺'}<input class="inp sm" inputmode="decimal" data-price="${v}" value="${p.prices && p.prices[v] != null ? p.prices[v] : ''}"></label>`).join('')}
          <label class="mini-l">Raf ömrü (gün)<input class="inp sm" inputmode="numeric" data-shelf value="${p.shelf_days ?? ''}"></label></div>
        <div class="row2"><button class="chip" data-tog="${p.id}">${p.active ? 'Satıştan kaldır' : 'Satışa al'}</button><button class="chip on" data-savep="${p.id}">Kaydet</button></div>
      </div>`;
    }).join('')}</div>
    <h3 class="sec">Yeni ürün ekle</h3>
    <label>Grup</label><select id="np-g" class="inp">${[...new Set(S.products.map(p => p.grp))].map(g => `<option>${esc(g)}</option>`).join('')}</select>
    <label>Ürün adı</label><input id="np-n" class="inp">
    <label>Sayım birimi</label><select id="np-u" class="inp">${['Adet', 'Boy (0/1/2)', 'Boy (0/1)', 'Kg', 'Paket', 'Dilim', 'Tepsi'].map(u => `<option>${u}</option>`).join('')}</select>
    <button class="big primary" data-act="np-add">Ürünü ekle</button>
  </main>${tabs()}`;
}

/* ================= GİRİŞ ================= */
let picked = '';
function viewLogin() {
  const acc = S.accounts || [];
  return `<main class="pad login">
    <img class="logo" src="logo.png" alt="Mevlana">
    <h1>Stok Takip</h1>
    <label>Şube</label>
    <div class="chips">${acc.filter(a => a.role !== 'admin').map(a => `<button class="chip ${picked === a.id ? 'on' : ''}" data-acc="${a.id}">${esc(a.name)}</button>`).join('')}</div>
    <label for="w">Adınız</label>
    <input id="w" class="inp" autocomplete="name" placeholder="Ad Soyad">
    <label for="pin">PIN</label>
    <input id="pin" class="inp pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">
    <p class="err" id="err"></p>
    <button class="big primary" data-act="login">Giriş</button>
    <button class="link ${picked === 'admin' ? 'on' : ''}" data-acc="admin">${picked === 'admin' ? '✓ Yönetici girişi seçildi' : 'Yönetici girişi'}</button>
  </main>`;
}

/* ================= render ================= */
async function render() {
  const s = API.session;
  try {
    if (!s) { $app.innerHTML = viewLogin(); return; }
    if (s.role === 'sube') {
      if (['menu', 'sevk', 'ozet', 'sayim'].includes(S.view) && S.view !== 'sayim') await SB.load();
      if (S.view === 'sayim' && !SB.day) await SB.load();
      $app.innerHTML = S.view === 'sevk' ? sbSevk() : S.view === 'sayim' ? sbSayim() : S.view === 'ozet' ? sbOzet() : sbMenu();
    } else if (s.role === 'imalathane') {
      if (S.view === 'im-liste') IM.list = await API.shipments();
      $app.innerHTML = S.view === 'im-yeni' ? imYeni() : S.view === 'im-liste' ? imListe() : imMenu();
    } else {
      await adLoad();
      $app.innerHTML = { bugun: adBugun, rapor: adRapor, detay: adDetay, talep: adTalep, ayar: adAyar }[S.tab]();
    }
  } catch (e) {
    $app.innerHTML = `${header('Hata', !!s)}<main class="pad"><div class="note warn">${esc(e.message)}</div><button class="big primary" data-act="retry">Tekrar dene</button></main>`;
  }
}

/* ================= olaylar ================= */
$app.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t || t.disabled) return;
  const d = t.dataset, s = API.session;
  if (d.acc) { picked = picked === d.acc && d.acc === 'admin' ? '' : d.acc; return render(); }
  if (d.grp) { S.open.has(d.grp) ? S.open.delete(d.grp) : S.open.add(d.grp); return rerenderList(); }
  if (d.go) return go(d.go);
  if (d.ctr) {
    if (s.role === 'sube') { const dr = SB.draft(); return bumpDraft(dr.kalan, d.k, +d.ctr, () => SB.save(dr)); }
    const dr = IM.drafts[IM.branch]; bumpDraft(dr, d.k, +d.ctr, () => {});
    const n = Object.values(dr).filter(q => q > 0).length, sb = document.querySelector('[data-act="im-send"]');
    if (sb) sb.textContent = 'Gönder' + (n ? ` (${n})` : ''); return;
  }
  if (d.rec) {
    const el = document.querySelector(`.cv[data-r="${d.i}"]`); const it = SB.pending.flatMap(x => x.items).find(i => i.id === +d.i);
    const st = stepOf(P(it.product_id) || { unit: 'Adet' });
    const v = Math.max(0, Math.min(+it.qty_sent * 3, Math.round((parseNum(el.textContent) + +d.rec * st) * 10) / 10));
    el.textContent = num(v); el.closest('.ctr').classList.toggle('short', v < +it.qty_sent); return;
  }
  if (d.delz != null && s.role === 'sube') { const dr = SB.draft(); dr.zayi.splice(+d.delz, 1); SB.save(dr); return render(); }
  if (d.imb) { IM.branch = d.imb; S.open.clear(); return render(); }
  if (d.tab) { S.tab = d.tab; window.scrollTo(0, 0); return render(); }
  if (d.range) { AD.range = d.range; await adLoad(); return render(); }
  if (d.br) { AD.branch = d.br; return render(); }
  if (d.det) { AD.detBranch = d.det; AD.detDay = bizDay(); S.tab = 'detay'; return render(); }
  if (d.detb) { AD.detBranch = d.detb; return render(); }
  if (d.dday) { AD.detDay = addDays(AD.detDay || bizDay(), +d.dday); return render(); }
  if (d.photo) { try { const src = await API.adminPhoto(+d.photo); showPhoto(src); } catch (x) { toast(x.message); } return; }
  if (d.corr) { try { await API.adminSetCorrection(+d.corr, d.st); await adLoad(true); render(); } catch (x) { toast(x.message); } return; }
  if (d.seen) { const sn = store.get('mvs_seen_eksik', []); sn.push(+d.seen); store.set('mvs_seen_eksik', sn); return render(); }
  if (d.pin) {
    const a = S.accounts.find(x => x.id === d.pin);
    const pin = prompt(`${a.name} için yeni 4 haneli PIN:`);
    if (pin == null) return;
    try { await API.adminSetPin(d.pin, pin.trim()); toast('PIN değişti. O hesaptaki herkes yeniden giriş yapacak.'); } catch (x) { toast(x.message); }
    return;
  }
  if (d.savep || d.tog) {
    const id = +(d.savep || d.tog), row = t.closest('.prow'), p = P(id);
    const body = { id };
    if (d.tog) body.active = !p.active;
    else {
      const prices = {};
      row.querySelectorAll('[data-price]').forEach(i => { const v = i.value.replace(',', '.').trim(); if (v !== '') prices[i.dataset.price] = +v; });
      body.prices = prices; body.shelf_days = row.querySelector('[data-shelf]').value.trim();
    }
    try { await API.adminSaveProduct(body); S.products = await API.products(); toast('Kaydedildi'); render(); } catch (x) { toast(x.message); }
    return;
  }
  switch (d.act) {
    case 'retry': return render();
    case 'back':
      if (s.role === 'imalathane' && S.view === 'im-yeni' && IM.branch) { IM.branch = null; return render(); }
      return go('menu');
    case 'logout':
      if (!confirm('Çıkış yapılsın mı?')) return;
      await API.logout(); S.view = 'login'; picked = ''; return render();
    case 'login': {
      const err = document.getElementById('err');
      try {
        if (!picked) throw new Error('Şube seçin');
        t.disabled = true; t.textContent = 'Giriş yapılıyor…';
        await API.login(picked, document.getElementById('w').value, document.getElementById('pin').value);
        S.products = await API.products(); S.view = 'menu'; S.tab = 'bugun'; render();
      } catch (x) { err.textContent = x.message; t.disabled = false; t.textContent = 'Giriş'; }
      return;
    }
    case 'zayi': return openZayi();
    case 'confirm-sevk': {
      const card = t.closest('.card'), sh = SB.pending.find(x => x.id === +d.id);
      const items = sh.items.map(i => ({ id: i.id, qty: parseNum(card.querySelector(`.cv[data-r="${i.id}"]`).textContent) }));
      const short = items.filter((x, i) => x.qty < +sh.items[i].qty_sent).length;
      if (!confirm(short ? `${short} üründe eksik var. "Gelmedi" olarak bildirilecek. Onaylıyor musun?` : 'Hepsi tam geldi. Onaylıyor musun?')) return;
      try { t.disabled = true; const r = await API.confirmShipment(sh.id, items); toast(r === 'tamam' ? 'Teslim alındı ✓' : 'Eksik bildirildi'); render(); }
      catch (x) { toast(x.message); t.disabled = false; }
      return;
    }
    case 'submit': {
      if (SB.pending.length && !confirm('Teslim alınmamış sevkiyat var. Yine de sayımı onaylamak istiyor musun?')) return;
      if (!confirm('Sayım ve zayi gönderilsin mi? Sonra değiştirilemez.')) return;
      const dr = SB.draft();
      const counts = Object.entries(dr.kalan).filter(([, q]) => q > 0).map(([k, q]) => { const [p, v] = splitK(k); return { product_id: p, variant: v, qty: q }; });
      try { t.disabled = true; t.textContent = 'Gönderiliyor…'; await API.submitDay(counts, dr.zayi); store.del(SB.key()); toast('Onaylandı ✓'); render(); }
      catch (x) { toast(x.message); t.disabled = false; t.textContent = 'Onayla ve gönder'; }
      return;
    }
    case 'corr': {
      const text = prompt('Ne düzeltilmeli? Kısaca yazın:');
      if (text && text.trim()) { try { await API.addCorrection(text.trim()); toast('Talep gönderildi'); render(); } catch (x) { toast(x.message); } }
      return;
    }
    case 'im-sube': IM.branch = null; return render();
    case 'im-send': {
      const dr = IM.drafts[IM.branch] || {};
      const items = Object.entries(dr).filter(([, q]) => q > 0).map(([k, q]) => { const [p, v] = splitK(k); return { product_id: p, variant: v, qty: q }; });
      if (!items.length) return toast('Ürün seçilmedi');
      const bn = branches().find(b => b.id === IM.branch).name;
      if (!confirm(`${bn} şubesine ${items.length} kalem gönderilsin mi?\n\n` + items.map(i => `• ${pname(i.product_id, i.variant)}: ${num(i.qty)}`).join('\n'))) return;
      try { t.disabled = true; await API.sendShipment(IM.branch, items); delete IM.drafts[IM.branch]; IM.branch = null; toast('Gönderildi ✓'); go('im-liste'); }
      catch (x) { toast(x.message); t.disabled = false; }
      return;
    }
    case 'ad-refresh': await adLoad(true); toast('Güncellendi'); return render();
    case 'np-add': {
      const name = document.getElementById('np-n').value.trim(); if (!name) return toast('Ürün adı yazın');
      try { await API.adminSaveProduct({ grp: document.getElementById('np-g').value, name, unit: document.getElementById('np-u').value }); S.products = await API.products(); toast('Ürün eklendi'); render(); }
      catch (x) { toast(x.message); }
      return;
    }
  }
});
function rerenderList() {
  const el = document.getElementById('plist'); if (!el) return render();
  el.innerHTML = productList(API.session.role === 'sube' ? SB.draft().kalan : IM.drafts[IM.branch]);
}
$app.addEventListener('input', e => {
  if (e.target.id === 'q') { S.search = e.target.value; rerenderList(); }
  if (e.target.id === 'pq') { AD.pq = e.target.value; const y = window.scrollY; render().then(() => { const i = document.getElementById('pq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); window.scrollTo(0, y); }); }
});
$app.addEventListener('change', e => { if (e.target.id === 'dday' && e.target.value) { AD.detDay = e.target.value; render(); } });
$app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'pin') document.querySelector('[data-act="login"]')?.click(); });
function showPhoto(src) {
  const m = document.createElement('div'); m.className = 'modal center'; m.innerHTML = `<img class="big-photo" src="${src}" alt="">`;
  m.onclick = () => m.remove(); document.body.appendChild(m);
}

/* ================= başlat ================= */
(async function init() {
  try { S.accounts = await API.accounts(); } catch (e) { S.accounts = []; }
  if (API.session) {
    try { S.products = await API.products(); S.view = 'menu'; } catch { /* oturum düştüyse giriş ekranı */ }
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
