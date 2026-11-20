/* Mevlana Stok — arayüz. Üç rol: şube, imalathane, yönetici. */
const $app = document.getElementById('app');
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const LABELS = [['0', 'Pzt'], ['00', 'Sal'], ['000', 'Çar'], ['0000', 'Per'], ['00000', 'Cum'], ['000000', 'Cmt'], ['0000000', 'Paz']];
const REASONS = ['Tarihi geçti', 'Düştü/ezildi', 'Bozuk geldi', 'Diğer'];
const KINDS = [['zayi', 'Zayi (çöp)'], ['personel', 'Personel yedi'], ['ikram', 'İkram'], ['imalathane_iade', 'İmalathaneye iade'], ['musteri_iade', 'Müşteri iadesi']];
const kindName = k => (KINDS.find(x => x[0] === (k || 'zayi')) || KINDS[0])[1];

const S = { products: [], view: 'login', search: '', open: new Set(), tab: 'bugun', wlist: {} };

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
function isOver(k, val) {
  if (!API.session || API.session.role !== 'sube' || !SB.hasPrev || val == null) return false;
  return val > (SB.expected[k] ?? 0) + 0.01;
}
function counter(p, v, draft) {
  const k = K(p.id, v), val = draft[k];
  return `<div class="ctr ${val ? 'has' : ''} ${val === 0 ? 'zero' : ''} ${isOver(k, val) ? 'over' : ''}">
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
      <div class="grp-b">${isOpen && API.session.role === 'sube' && filledSlots(g.items, draft) < slotsOf(g.items) ? `<button class="chip zero-btn" data-zero="${esc(g.name)}">Kalan boşları 0 yap (rafta yok)</button>` : ''}${isOpen ? g.items.map(p => {
        const vs = variantsOf(p);
        return `<div class="row ${vs ? 'multi' : ''}">
          <div class="nm">${esc(p.name)}<small>${vs ? '' : esc(p.unit)}</small></div>
          ${(vs || [null]).map(v => counter(p, v, draft)).join('')}
        </div>`;
      }).join('') : ''}</div>
    </section>`;
  }).join('');
}
const slotsOf = items => items.reduce((a, p) => a + (variantsOf(p) || [null]).length, 0);
const filledSlots = (items, draft) => items.reduce((a, p) => a + (variantsOf(p) || [null]).filter(v => draft[K(p.id, v)] != null).length, 0);
function bumpDraft(draft, k, dir, saveFn) {
  const [pid] = splitK(k), p = P(pid), st = stepOf(p);
  let next = Math.max(0, Math.round(((draft[k] ?? 0) + dir * st) * 10) / 10);
  draft[k] = next; saveFn();
  const el = document.querySelector(`.cv[data-v="${CSS.escape(k)}"]`);
  if (el) { const c = el.closest('.ctr'); el.textContent = num(next); c.classList.toggle('has', next > 0); c.classList.toggle('zero', next === 0); c.classList.toggle('over', isOver(k, next)); }
  updateProgress();
  if (navigator.vibrate) navigator.vibrate(8);
}

/* ================= ŞUBE ================= */
const SB = {
  day: null, pending: [], doneToday: [], expected: {}, hasPrev: false,
  key() { return `mvs_draft_${API.session.account}_${bizDay()}`; },
  draft() { return store.get(this.key(), { kalan: {}, zayi: [] }); },
  save(d) { store.set(this.key(), d); },
  async load() {
    const [day, sh, ex] = await Promise.all([API.myDay(), API.shipments(), API.myExpected()]);
    this.day = day;
    this.hasPrev = !!(ex && ex.has_prev); this.expected = {};
    for (const it of (ex && ex.items) || []) this.expected[K(it.product_id, it.variant)] = +it.max;
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
    <button class="big ghost" data-go="yok">🙋 Müşteri istedi, yoktu${d.misses && d.misses.length ? ` <span class="pill sm">${d.misses.length}</span>` : ''}</button>
  </main>`;
}
function sbYok() {
  const ms = SB.day.misses || [];
  return `${header('Müşteri istedi, yoktu', true)}<main class="pad">
    <p class="muted">Müşteri sorup da rafta olmayan ürünleri buraya yazın. Bunlar satış sayılmaz, hangi üründen az gönderildiğini gösterir.</p>
    <button class="big primary" data-act="miss">+ Yeni ekle</button>
    <h3 class="sec">Bugün yazılanlar</h3>
    ${ms.length ? `<ul class="ln">${ms.map(m => `<li><span>${esc(pname(m.product_id, m.variant))}<small>${hhmm(m.at)}${m.note ? ' · ' + esc(m.note) : ''}</small></span><b>${num(m.qty)}</b></li>`).join('')}</ul>` : '<p class="empty small">Henüz yok</p>'}
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
  <main class="list"><div id="prog">${progressHtml(d.kalan)}</div><p class="muted hint">Raftaki kalanları sayın. Rafta olmayanlara − ile 0 girin ya da grubun içindeki "0 yap" butonunu kullanın.</p><div id="plist">${productList(d.kalan)}</div></main>
  <footer class="bar">
    <button class="big ghost" data-act="zayi">+ Zayi / Çıkış${d.zayi.length ? ` (${d.zayi.length})` : ''}</button>
    <button class="big primary" data-go="ozet">Özete geç</button>
  </footer>`;
}

function progressHtml(kalan) {
  const act = S.products.filter(p => p.active), tot = slotsOf(act), done = filledSlots(act, kalan), pc = tot ? Math.round(done / tot * 100) : 0;
  return `<div class="prog"><div class="prog-t"><b>${done} / ${tot}</b> sayıldı <span>%${pc}</span></div><div class="prog-b"><i style="width:${pc}%"></i></div></div>`;
}
function updateProgress() {
  const el = document.getElementById('prog');
  if (el && API.session.role === 'sube') el.innerHTML = progressHtml(SB.draft().kalan);
}
function sbOzet() {
  const day = SB.day;
  if (day.submitted) {
    return `${header('Özet', true)}<main class="pad sum">
      <p class="muted">${trDate(day.day)} · ${esc(day.worker)} · ${hhmm(day.at)}</p>
      <div class="note ok">Onaylandı ✓ — kayıt kilitli.</div>
      <h3>Gün sonu kalan</h3>${day.counts.length ? `<ul class="ln">${day.counts.map(c => `<li><span>${esc(pname(c.product_id, c.variant))}</span><b>${num(c.qty)}</b></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
      <h3>Zayi ve diğer çıkışlar</h3>${day.waste.length ? `<ul class="ln">${day.waste.map(w => `<li><span>${esc(pname(w.product_id, w.variant))}<small>${esc(kindName(w.kind))}${w.label ? ' · ' + esc(w.label) : ''}${w.reason ? ' · ' + esc(w.reason) : ''}${w.note ? ' · ' + esc(w.note) : ''}</small></span><b>${num(w.qty)}</b></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
      ${day.corrections.length ? `<h3>Düzeltme talepleri</h3><ul class="ln">${day.corrections.map(c => `<li><span>${esc(c.body)}<small>${hhmm(c.at)}</small></span><b>${c.status === 'bekliyor' ? '⏳' : '✓'}</b></li>`).join('')}</ul>` : ''}
      <button class="big ghost" data-act="corr">Düzeltme talebi gönder</button>
    </main>`;
  }
  const d = SB.draft();
  const counts = Object.entries(d.kalan).filter(([, q]) => q > 0);
  const zeros = Object.values(d.kalan).filter(q => q === 0).length;
  const groups = {};
  for (const p of S.products.filter(p => p.active)) {
    const miss = (variantsOf(p) || [null]).filter(v => d.kalan[K(p.id, v)] == null).length;
    if (miss) groups[p.grp] = (groups[p.grp] || 0) + miss;
  }
  const missTot = Object.values(groups).reduce((a, b) => a + b, 0);
  const overs = Object.entries(d.kalan).filter(([k, q]) => isOver(k, q));
  return `${header('Özet ve Onay', true)}
  <main class="pad sum">
    <p class="muted">Bugün girdiklerin · ${trDate(bizDay())}</p>
    ${progressHtml(d.kalan)}
    ${overs.length ? `<div class="note warn"><b>Bu sayılar olağandışı görünüyor:</b><ul class="ln tight">${overs.map(([k, q]) => `<li><span>${esc(pname(...splitK(k)))}<small>Dünkü kalan + bugün gelen = en fazla ${num(SB.expected[k] ?? 0)}</small></span><b>${num(q)}</b></li>`).join('')}</ul>Yanlışsa sayıma dönüp düzeltin.</div>` : ''}
    ${missTot ? `<div class="note warn"><b>${missTot} kalem sayılmadı</b> (boylar ayrı sayılır). Bunlar için bugün satış hesaplanmayacak:<br>${Object.entries(groups).map(([g, n]) => `${esc(g)} (${n})`).join(', ')}</div>` : `<div class="note ok">Bütün ürünler sayıldı ✓</div>`}
    <h3>Gün sonu kalan</h3>${counts.length ? `<ul class="ln">${counts.map(([k, q]) => { const [p, v] = splitK(k); return `<li><span>${esc(pname(p, v))}</span><b>${num(q)}</b></li>`; }).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
    ${zeros ? `<p class="muted">${zeros} kalem rafta yok (0) olarak işaretlendi.</p>` : ''}
    <h3>Zayi ve diğer çıkışlar</h3>${d.zayi.length ? `<ul class="ln">${d.zayi.map((z, i) => `<li><span>${esc(pname(z.product_id, z.variant))}<small>${esc(kindName(z.kind))}${z.label ? ' · ' + esc(z.label) : ''}${z.reason ? ' · ' + esc(z.reason) : ''}${z.note ? ' · ' + esc(z.note) : ''}</small></span>
      <b>${num(z.qty)}</b>${z.photo ? `<img src="${z.photo}" alt="">` : ''}<button class="x" data-delz="${i}" aria-label="Sil">✕</button></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
    ${SB.pending.length ? `<div class="note warn">Teslim alınmamış ${SB.pending.length} sevkiyat var. Önce onları onaylayın.</div>` : ''}
    <button class="big primary" data-act="submit">Onayla ve gönder</button>
    <p class="muted center">Onaydan sonra değiştirilemez.</p>
  </main>`;
}

function openZayi() {
  const z = { kind: 'zayi', product_id: null, variant: null, qty: 1, label: labelOf(addDays(bizDay(), -1))[0], reason: '', note: '', photo: null, q: '' };
  const m = document.createElement('div'); m.className = 'modal';
  const draw = () => {
    const p = z.product_id ? P(z.product_id) : null, vs = p && variantsOf(p);
    m.innerHTML = `<div class="sheet">
      <div class="sh-h"><b>Zayi / Çıkış Ekle</b><button class="icon-btn dark" data-z="close">✕</button></div>
      <label>Ne oldu?</label>
      <div class="chips">${KINDS.map(([id, t]) => `<button class="chip ${z.kind === id ? 'on' : ''}" data-z="kind" data-v="${id}">${t}</button>`).join('')}</div>
      ${z.kind === 'musteri_iade' ? '<p class="muted">Müşterinin geri getirdiği ve rafa konan ürün. Satıştan düşülür.</p>' : ''}
      <label>Ürün</label>
      <input id="zq" class="inp" placeholder="Ürün ara…" autocomplete="off" value="${esc(p ? p.name : z.q)}">
      <div id="zres" class="zres"></div>
      ${vs ? `<label>Boy</label><div class="chips">${vs.map(v => `<button class="chip ${z.variant === v ? 'on' : ''}" data-z="var" data-v="${v}">Boy ${v}</button>`).join('')}</div>` : ''}
      <label>Miktar${p ? ` (${esc(unitShort(p))})` : ''}</label>
      <div class="ctr big-ctr"><button class="cb minus" data-z="m">−</button><span class="cv">${num(z.qty)}</span><button class="cb plus" data-z="p">+</button></div>
      ${z.kind === 'zayi' || z.kind === 'imalathane_iade' ? `<label>Etiket (kaç sıfır?)</label>
      <div class="chips">${LABELS.map(([c, d]) => `<button class="chip ${z.label === c ? 'on' : ''}" data-z="lab" data-v="${c}">${c} <small>${d}</small></button>`).join('')}</div>` : ''}
      ${z.kind === 'zayi' ? `<label>Neden</label>
      <div class="chips">${REASONS.map(r => `<button class="chip ${z.reason === r ? 'on' : ''}" data-z="rea" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
      ${z.reason === 'Diğer' || z.kind !== 'zayi' ? `<input id="zn" class="inp" placeholder="Açıklama (isteğe bağlı)" value="${esc(z.note)}">` : ''}
      ${z.kind === 'zayi' ? `<label>Fotoğraf (isteğe bağlı)</label>
      <div class="photo">${z.photo ? `<img src="${z.photo}" alt=""><button class="chip" data-z="nophoto">Kaldır</button>` : `<label class="chip file">📷 Fotoğraf çek<input id="zf" type="file" accept="image/*" capture="environment" hidden></label>`}</div>` : ''}
      <p class="err" id="zerr"></p>
      <button class="big primary" data-z="save">Ekle</button>
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
    if (a === 'kind') { z.kind = val; if (val !== 'zayi') { z.reason = ''; z.photo = null; } }
    if (a === 'lab') z.label = val;
    if (a === 'rea') z.reason = val;
    if (a === 'm' || a === 'p') { const st = z.product_id ? stepOf(P(z.product_id)) : 1; z.qty = Math.max(st, Math.round((z.qty + (a === 'p' ? st : -st)) * 10) / 10); }
    if (a === 'nophoto') z.photo = null;
    if (a === 'save') {
      const p = z.product_id && P(z.product_id), err = m.querySelector('#zerr');
      const bad = !p ? 'Ürün seçin' : (variantsOf(p) && z.variant == null) ? 'Boy seçin' : (z.kind === 'zayi' && !z.reason) ? 'Neden seçin' : '';
      if (bad) { err.textContent = bad; return; }
      const d = SB.draft(), withLabel = z.kind === 'zayi' || z.kind === 'imalathane_iade';
      d.zayi.push({ kind: z.kind, product_id: z.product_id, variant: z.variant, qty: z.qty, label: withLabel ? z.label : '', reason: z.kind === 'zayi' ? z.reason : '', note: z.note, photo: z.kind === 'zayi' ? z.photo : null });
      SB.save(d); m.remove(); toast(kindName(z.kind) + ' eklendi'); render(); return;
    }
    draw();
  });
  m.addEventListener('change', async e => {
    if (e.target.id !== 'zf' || !e.target.files[0]) return;
    z.photo = await shrink(e.target.files[0]); draw();
  });
  document.body.appendChild(m); draw();
}
function openMiss() {
  const z = { product_id: null, variant: null, qty: 1, note: '', q: '' };
  const m = document.createElement('div'); m.className = 'modal';
  const draw = () => {
    const p = z.product_id ? P(z.product_id) : null, vs = p && variantsOf(p);
    m.innerHTML = `<div class="sheet">
      <div class="sh-h"><b>Müşteri istedi, yoktu</b><button class="icon-btn dark" data-z="close">✕</button></div>
      <label>Ürün</label>
      <input id="zq" class="inp" placeholder="Ürün ara…" autocomplete="off" value="${esc(p ? p.name : z.q)}">
      <div id="zres" class="zres"></div>
      ${vs ? `<label>Boy</label><div class="chips">${vs.map(v => `<button class="chip ${z.variant === v ? 'on' : ''}" data-z="var" data-v="${v}">Boy ${v}</button>`).join('')}</div>` : ''}
      <label>Kaç tane istendi?</label>
      <div class="ctr big-ctr"><button class="cb minus" data-z="m">−</button><span class="cv">${num(z.qty)}</span><button class="cb plus" data-z="p">+</button></div>
      <input id="zn" class="inp" placeholder="Not (isteğe bağlı)" value="${esc(z.note)}">
      <p class="err" id="zerr"></p>
      <button class="big primary" data-z="save">Kaydet</button>
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
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-z]');
    if (!b) { if (e.target === m) m.remove(); return; }
    const a = b.dataset.z, n = m.querySelector('#zn'); if (n) z.note = n.value;
    if (a === 'close') return m.remove();
    if (a === 'pick') { z.product_id = +b.dataset.id; z.variant = null; z.qty = stepOf(P(z.product_id)) === 0.5 ? 0.5 : 1; }
    if (a === 'var') z.variant = b.dataset.v;
    if (a === 'm' || a === 'p') { const st = z.product_id ? stepOf(P(z.product_id)) : 1; z.qty = Math.max(st, Math.round((z.qty + (a === 'p' ? st : -st)) * 10) / 10); }
    if (a === 'save') {
      const p = z.product_id && P(z.product_id), err = m.querySelector('#zerr');
      const bad = !p ? 'Ürün seçin' : (variantsOf(p) && z.variant == null) ? 'Boy seçin' : '';
      if (bad) { err.textContent = bad; return; }
      b.disabled = true;
      try { await API.addMiss(z.product_id, z.variant || '', z.qty, z.note); m.remove(); toast('Kaydedildi'); render(); }
      catch (x) { err.textContent = x.message; b.disabled = false; }
      return;
    }
    draw();
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
      <ul class="ln">${s.items.map(i => `<li><span>${esc(pname(i.product_id, i.variant))}</span><b>${num(i.qty_sent)}${i.qty_received != null && +i.qty_received !== +i.qty_sent ? ` → ${num(i.qty_received)}` : ''}</b></li>`).join('')}</ul>
      ${s.status === 'bekliyor' ? `<button class="big ghost danger" data-cancel="${s.id}">Bu sevkiyatı iptal et</button>` : ''}</section>`).join('')
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
// Fiyat geçmişi: o günün fiyatıyla hesap
let PH = {};
function buildPH(data) { PH = {}; for (const r of (data && data.prices) || []) (PH[r.p] ||= []).push(r); for (const k in PH) PH[k].sort((a, b) => a.from < b.from ? -1 : 1); }
const priceOf = (pid, v, day) => {
  let pr = null; const h = PH[pid];
  if (h && day) for (const r of h) if (r.from <= day) pr = r.prices;
  if (!pr) { const p = P(pid); pr = p && p.prices; }
  if (!pr) return 0;
  return +(pr[v ?? ''] ?? pr[''] ?? 0) || 0;
};

// Satış hesabı (ürün başına): son sayılan kalan + o zamandan beri gelen + müşteri iadesi − bugünkü kalan − çıkışlar
// v2 sayımlarda kaydı olmayan ürün "sayılmadı" demektir: o gün satış hesaplanmaz, sonraki sayıma devredilir.
function computeDays(data) {
  buildPH(data);
  const out = [], subsBy = {}, countsBy = {}, outBy = {}, inBy = {}, wasteBy = {}, otherBy = {};
  for (const s of data.submissions) (subsBy[s.branch] ||= []).push(s);
  for (const c of data.counts) ((countsBy[c.sid] ||= {})[K(c.p, c.v)] = +c.q);
  for (const w of data.waste) {
    const k = K(w.p, w.v), kind = w.kind || 'zayi', q = +w.q;
    const tgt = kind === 'musteri_iade' ? inBy : outBy;
    const m = (tgt[w.sid] ||= {}); m[k] = (m[k] || 0) + q;
    if (kind === 'zayi') { const z = (wasteBy[w.sid] ||= {}); z[k] = (z[k] || 0) + q; }
    else { const o = (otherBy[w.sid] ||= {}); const ok = kind + '|' + k; o[ok] = (o[ok] || 0) + q; }
  }
  const slots = [];
  for (const p of S.products.filter(p => p.active)) for (const v of variantsOf(p) || [null]) slots.push(K(p.id, v));
  for (const [b, subs] of Object.entries(subsBy)) {
    subs.sort((a, c) => a.day < c.day ? -1 : 1);
    const last = {}, acc = {};
    let prevDay = null;
    subs.forEach((s, i) => {
      const rec = {};
      for (const sh of data.shipments) {
        if (sh.branch !== b || sh.status === 'bekliyor' || !sh.day) continue;
        if (sh.day > s.day || (prevDay ? sh.day <= prevDay : sh.day < s.day)) continue;
        for (const it of sh.items) { const k = K(it.p, it.v); rec[k] = (rec[k] || 0) + +(it.rec ?? it.sent); }
      }
      const kalanRaw = countsBy[s.id] || {}, outs = outBy[s.id] || {}, ins = inBy[s.id] || {};
      const counted = k => !s.v2 || k in kalanRaw;
      const keys = new Set([...Object.keys(last), ...Object.keys(acc), ...Object.keys(rec), ...Object.keys(kalanRaw), ...Object.keys(outs), ...Object.keys(ins)]);
      const sold = {}, avail = {}, kalan = {}, neg = [];
      for (const k of keys) {
        const a = (acc[k] ||= { rec: 0, out: 0, inn: 0 });
        a.rec += rec[k] || 0; a.out += outs[k] || 0; a.inn += ins[k] || 0;
        if (!counted(k)) continue;
        const kal = kalanRaw[k] || 0; kalan[k] = kal;
        if (i > 0) {
          const open = last[k] || 0;
          avail[k] = open + a.rec + a.inn;
          const q = Math.round((avail[k] - kal - a.out) * 10) / 10;
          if (q > 0) sold[k] = q;
          else if (q < 0) neg.push({ k, q, open, rec: a.rec, kal, out: a.out });
        }
        last[k] = kal; acc[k] = { rec: 0, out: 0, inn: 0 };
      }
      const uncounted = s.v2 ? slots.filter(k => !(k in kalanRaw)) : [];
      out.push({ branch: b, day: s.day, worker: s.worker, at: s.at, sid: s.id, v2: s.v2, sold, waste: wasteBy[s.id] || {}, other: otherBy[s.id] || {},
        rec, kalan, avail, base: i === 0, neg, uncounted });
      prevDay = s.day;
    });
  }
  return out;
}
function aggregate(days, from, to, branch) {
  const sel = days.filter(d => d.day >= from && d.day <= to && (branch === 'all' || d.branch === branch));
  const prod = {}, byDay = {}, byDow = [0, 0, 0, 0, 0, 0, 0], dowN = [0, 0, 0, 0, 0, 0, 0], otherTL = {};
  const P0 = k => (prod[k] ||= { s: 0, w: 0, st: 0, wt: 0, r: 0, a: 0 });
  let soldTL = 0, wasteTL = 0, soldQ = 0, wasteQ = 0, recTL = 0, uncounted = 0, neg = 0;
  for (const d of sel) {
    let dayTL = 0;
    for (const [k, q] of Object.entries(d.sold)) { const [p, v] = splitK(k); const t = q * priceOf(p, v, d.day); P0(k).s += q; prod[k].st += t; soldTL += t; soldQ += q; dayTL += t; }
    for (const [k, q] of Object.entries(d.waste)) { const [p, v] = splitK(k); const t = q * priceOf(p, v, d.day); P0(k).w += q; prod[k].wt += t; wasteTL += t; wasteQ += q; }
    for (const [ok, q] of Object.entries(d.other)) { const [kind, k] = ok.split('|'); const [p, v] = splitK(k); otherTL[kind] = (otherTL[kind] || 0) + q * priceOf(p, v, d.day); }
    for (const [k, q] of Object.entries(d.rec)) { const [p, v] = splitK(k); P0(k).r += q; recTL += q * priceOf(p, v, d.day); }
    for (const [k, q] of Object.entries(d.avail)) P0(k).a += q;
    uncounted += d.uncounted.length; neg += d.neg.length;
    if (!d.base) { byDay[d.day] = (byDay[d.day] || 0) + dayTL; }
  }
  for (const [day, t] of Object.entries(byDay)) { byDow[dow(day)] += t; dowN[dow(day)]++; }
  return { sel, prod, byDay, byDow: byDow.map((t, i) => dowN[i] ? t / dowN[i] : 0), soldTL, wasteTL, soldQ, wasteQ, recTL, otherTL, uncounted, neg };
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
        ${d && d.uncounted.length ? `<small class="warn-t">⚠ ${d.uncounted.length} kalem sayılmadı</small>` : ''}
        ${d && d.neg.length ? `<small class="warn-t">⚠ ${d.neg.length} üründe tutarsız sayı</small>` : ''}
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
  for (const d of ag.sel) for (const w of AD.data.waste.filter(w => w.sid === d.sid && (w.kind || 'zayi') === 'zayi')) reasons[w.reason || 'Belirtilmedi'] = (reasons[w.reason || 'Belirtilmedi'] || 0) + +w.q * priceOf(w.p, w.v, d.day);
  const misses = {};
  for (const m of AD.data.misses || []) if (m.day >= from && m.day <= to && (AD.branch === 'all' || m.branch === AD.branch)) { const k = K(m.p, m.v); misses[k] = (misses[k] || 0) + +m.q; }
  const missTop = Object.entries(misses).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const others = Object.entries(ag.otherTL).filter(([, v]) => v > 0);
  const R = [['1', 'Bugün'], ['dun', 'Dün'], ['7', '7 gün'], ['30', '30 gün'], ['ay', 'Bu ay'], ['gecenay', 'Geçen ay']];
  return `${header('Raporlar')}<main class="pad admin">
    <div class="chips sm">${R.map(([id, t]) => `<button class="chip ${AD.range === id ? 'on' : ''}" data-range="${id}">${t}</button>`).join('')}</div>
    <div class="chips sm">${[['all', 'Tüm şubeler'], ...branches().map(b => [b.id, b.name])].map(([id, t]) => `<button class="chip ${AD.branch === id ? 'on' : ''}" data-br="${id}">${esc(t)}</button>`).join('')}</div>
    <p class="muted">${trDate(from)} – ${trDate(to)}</p>
    <div class="row2"><button class="big ghost" data-xls="0">⬇ Bu ayın Excel'i</button><button class="big ghost" data-xls="-1">⬇ Geçen ayın Excel'i</button></div>
    <div class="kpis">
      <div class="kpi"><small>Satış</small><b>${tl(ag.soldTL)}</b><small>${num(ag.soldQ)} birim</small></div>
      <div class="kpi red"><small>Zayi</small><b>${tl(ag.wasteTL)}</b><small>Gelenin %${pct(ag.wasteTL, ag.recTL)}'i</small></div>
    </div>
    <h3 class="sec">En çok satanlar</h3>${top.length ? bars(top.map(r => [pname(...splitK(r.k)), r.st]), tl) : '<p class="empty small">Veri yok</p>'}
    <h3 class="sec">En az satanlar <small>(raftakinin yüzde kaçı satıldı)</small></h3>${low.length ? bars(low.map(r => [pname(...splitK(r.k)), pct(r.s, r.a)]), v => '%' + v) : '<p class="empty small">Veri yok</p>'}
    <h3 class="sec">En çok zayi olanlar</h3>${waste.length ? bars(waste.map(r => [pname(...splitK(r.k)), r.wt]), tl) : '<p class="empty small">Zayi yok</p>'}
    ${Object.keys(reasons).length ? `<h3 class="sec">Zayi nedenleri</h3>${bars(Object.entries(reasons), tl)}` : ''}
    ${ag.uncounted || ag.neg ? `<div class="note warn">${ag.uncounted ? `Bu dönemde ${ag.uncounted} kalem-gün sayılmamış; o ürünlerin satışı bir sonraki sayıma eklendi. ` : ''}${ag.neg ? `${ag.neg} yerde tutarsız sayı var (satış eksi çıkıyor). Şubeler sekmesinde ⚠ ile işaretli.` : ''}</div>` : ''}
    <h3 class="sec">Müşteri istedi, yoktu <small>(kaçan satış, adet)</small></h3>${missTop.length ? bars(missTop.map(([k, q]) => [pname(...splitK(k)), q]), num) : '<p class="empty small">Kayıt yok</p>'}
    ${others.length ? `<h3 class="sec">Diğer çıkışlar <small>(satış fiyatıyla)</small></h3>${bars(others.map(([k, v]) => [kindName(k), v]), tl)}` : ''}
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
  const list = (obj, f) => { const e = Object.entries(obj).filter(([, q]) => q > 0); return e.length ? `<ul class="ln">${e.map(([k, q]) => `<li><span>${esc(pname(...splitK(k)))}</span><b>${num(q)}</b>${f ? `<small class="r">${tl(q * priceOf(...splitK(k), day))}</small>` : ''}</li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'; };
  const ms = (AD.data.misses || []).filter(m => m.branch === b && m.day === day);
  return `${header('Şube Detayı')}<main class="pad admin">
    <div class="chips sm">${branches().map(x => `<button class="chip ${x.id === b ? 'on' : ''}" data-detb="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="daynav"><button class="chip" data-dday="-1">‹ Önceki</button><input type="date" id="dday" class="inp" value="${day}" max="${bizDay()}"><button class="chip" data-dday="1" ${day >= bizDay() ? 'disabled' : ''}>Sonraki ›</button></div>
    ${d ? `<div class="note ok">Sayım: ${esc(d.worker)} · ${hhmm(d.at)}</div>` : `<div class="note warn">Bu gün sayım girilmemiş.</div>`}
    ${d && d.neg.length ? `<div class="note warn"><b>⚠ Tutarsız sayılar</b> (satış eksi çıkıyor, sayım ya da sevkiyat hatalı olabilir):<ul class="ln tight">${d.neg.map(n => `<li><span>${esc(pname(...splitK(n.k)))}<small>önceki ${num(n.open)} + gelen ${num(n.rec)} − kalan ${num(n.kal)} − çıkış ${num(n.out)}</small></span><b>${num(n.q)}</b></li>`).join('')}</ul></div>` : ''}
    ${d && d.uncounted.length ? `<div class="note warn">${d.uncounted.length} kalem sayılmadı: ${d.uncounted.slice(0, 12).map(k => esc(pname(...splitK(k)))).join(', ')}${d.uncounted.length > 12 ? '…' : ''}</div>` : ''}
    <h3 class="sec">Satılan (hesaplanan)</h3>${d && !d.base ? list(d.sold, true) : '<p class="empty small">Hesaplanamıyor (önceki gün sayımı yok)</p>'}
    <h3 class="sec">Gün sonu kalan</h3>${d ? `<ul class="ln">${Object.entries(d.kalan).filter(([, q]) => q >= 0).sort((a, c) => (c[1] > 0) - (a[1] > 0)).map(([k, q]) => `<li><span>${esc(pname(...splitK(k)))}</span><b>${num(q)}</b><button class="chip ed" data-editc="${k}" data-sid="${d.sid}" data-q="${q}" aria-label="Düzelt">✎</button></li>`).join('') || '<li><span class="muted">Kayıt yok</span></li>'}</ul>
      <button class="chip" data-addc="${d.sid}">+ Kalan ekle / düzelt</button>` : '<p class="empty small">–</p>'}
    <h3 class="sec">Zayi ve diğer çıkışlar</h3>${wl.length ? `<ul class="ln">${wl.map(w => `<li><span>${esc(pname(w.p, w.v))}<small>${esc(kindName(w.kind))}${w.label ? ' · ' + esc(w.label) : ''}${w.reason ? ' · ' + esc(w.reason) : ''}${w.note ? ' · ' + esc(w.note) : ''}</small></span><b>${num(w.q)}</b>${w.photo ? `<button class="chip" data-photo="${w.id}">📷</button>` : ''}<button class="chip ed" data-editw="${w.id}" data-q="${w.q}" aria-label="Düzelt">✎</button></li>`).join('')}</ul>` : '<p class="empty small">Zayi yok</p>'}
    ${d ? `<p class="muted">✎ ile sayıyı değiştirebilirsin (kalanda 0 = rafta yok, zayide 0 = sil). Düzeltmeler satış hesabına hemen yansır ve değişiklik kaydına yazılır.</p>` : ''}
    <h3 class="sec">Müşteri istedi, yoktu</h3>${ms.length ? `<ul class="ln">${ms.map(m => `<li><span>${esc(pname(m.p, m.v))}<small>${esc(m.worker)} · ${hhmm(m.at)}${m.note ? ' · ' + esc(m.note) : ''}</small></span><b>${num(m.q)}</b></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>'}
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
    <h3 class="sec">Çalışanlar</h3>
    <p class="muted">Liste boşsa çalışan adını kendisi yazar. İsim eklersen girişte sadece listedekiler seçilebilir.</p>
    ${S.accounts.filter(a => a.role !== 'admin').map(a => {
      const ws = (AD.data.workers || []).filter(w => w.account === a.id);
      return `<div class="wrow"><b>${esc(a.name)}</b><div class="chips">${ws.map(w => `<span class="chip on">${esc(w.name)}<button class="x" data-wdel="${a.id}" data-n="${esc(w.name)}" aria-label="Kaldır">✕</button></span>`).join('')}
        <button class="chip" data-wadd="${a.id}">+ Ekle</button></div></div>`;
    }).join('')}
    <h3 class="sec">Değişiklik kaydı</h3>
    ${AD.audit ? (AD.audit.length ? `<ul class="ln">${AD.audit.map(x => `<li><span>${esc(auditText(x))}<small>${dayTime(x.at)} · ${esc(x.actor)}</small></span></li>`).join('')}</ul>` : '<p class="empty small">Kayıt yok</p>')
      : `<button class="big ghost" data-act="audit">Son değişiklikleri göster</button>`}
    <h3 class="sec">Ürünler, fiyatlar ve raf ömrü</h3>
    <p class="muted">Fiyat değişikliği bugünden itibaren geçerli olur, geçmiş günlerin cirosu eski fiyatla kalır.</p>
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

const AUDIT_NAMES = { kalan_duzeltme: 'Kalan düzeltildi', zayi_duzeltme: 'Zayi düzeltildi', personel_duzeltme: 'Personel çıkışı düzeltildi', ikram_duzeltme: 'İkram düzeltildi',
  imalathane_iade_duzeltme: 'İade düzeltildi', musteri_iade_duzeltme: 'Müşteri iadesi düzeltildi', sevkiyat_iptal: 'Sevkiyat iptal edildi', pin_degisti: 'PIN değişti',
  fiyat_degisti: 'Fiyat değişti', raf_omru_degisti: 'Raf ömrü değişti', urun_eklendi: 'Ürün eklendi', urun_kaldirildi: 'Ürün satıştan kaldırıldı', urun_satisa_alindi: 'Ürün satışa alındı',
  talep_yapildi: 'Talep tamamlandı', talep_reddedildi: 'Talep reddedildi', calisan_ekle: 'Çalışan eklendi', calisan_sil: 'Çalışan kaldırıldı' };
function auditText(x) {
  let t = (AUDIT_NAMES[x.action] || x.action) + (x.target ? ' — ' + x.target.replace(/ürün (\d+)/, (m, id) => (P(id) || {}).name || m) : '');
  const f = v => v == null ? '–' : typeof v === 'object' ? Object.entries(v).map(([k, q]) => (k ? 'Boy ' + k + ': ' : '') + q).join(', ') || '–' : String(v);
  if (x.old_value != null || x.new_value != null) if (!['sevkiyat_iptal', 'urun_eklendi'].includes(x.action)) t += ` (${f(x.old_value)} → ${f(x.new_value)})`;
  return t;
}

/* ================= EXCEL ================= */
async function exportMonth(offset) {
  const today = bizDay();
  let first = today.slice(0, 8) + '01';
  if (offset < 0) first = addDays(first, -1).slice(0, 8) + '01';
  const last = offset < 0 ? addDays(today.slice(0, 8) + '01', -1) : today;
  const ym = first.slice(0, 7), AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const ayAdi = AY[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4);
  const data = await API.adminData(first, last);
  const days = computeDays(data), bn = id => (data.accounts.find(a => a.id === id) || {}).name || id;
  const inM = d => d.day >= first && d.day <= last;
  const pinfo = k => { const [p, v] = splitK(k), pr = P(p); return [pr ? pr.name : '#' + p, v != null ? 'Boy ' + v : '', pr ? unitShort(pr) : '', priceOf(p, v)]; };
  // Özet
  const ozet = [['Şube', 'Satış (₺)', 'Zayi (₺)', 'Net (₺)', 'Zayi oranı %', 'Sayım yapılan gün']]; let tS = 0, tW = 0;
  for (const b of data.accounts.filter(a => a.role === 'sube')) {
    const ag = aggregate(days, first, last, b.id); tS += ag.soldTL; tW += ag.wasteTL;
    ozet.push([b.name, ag.soldTL, ag.wasteTL, ag.soldTL - ag.wasteTL, ag.recTL ? Math.round(ag.wasteTL / ag.recTL * 1000) / 10 : 0, ag.sel.length]);
  }
  ozet.push(['TOPLAM', tS, tW, tS - tW, null, null]);
  // Ürünler (tüm şubeler)
  const all = aggregate(days, first, last, 'all');
  const urun = [['Ürün', 'Boy', 'Birim', 'Güncel fiyat (₺)', 'Satılan', 'Satış (₺)', 'Zayi miktar', 'Zayi (₺)', 'Net (₺)']];
  Object.entries(all.prod).filter(([, r]) => r.s || r.w).sort((a, b) => (b[1].st - b[1].wt) - (a[1].st - a[1].wt))
    .forEach(([k, r]) => { const [n, v, u, pr] = pinfo(k); urun.push([n, v, u, pr, r.s, r.st, r.w, r.wt, r.st - r.wt]); });
  // Şube-ürün
  const subeUrun = [['Şube', 'Ürün', 'Boy', 'Satılan', 'Satış (₺)', 'Zayi miktar', 'Zayi (₺)']];
  for (const b of data.accounts.filter(a => a.role === 'sube')) {
    const ag = aggregate(days, first, last, b.id);
    Object.entries(ag.prod).filter(([, r]) => r.s || r.w).sort((a, c) => c[1].st - a[1].st)
      .forEach(([k, r]) => { const [n, v] = pinfo(k); subeUrun.push([b.name, n, v, r.s, r.st, r.w, r.wt]); });
  }
  // Günlük
  const gunluk = [['Tarih', 'Gün', 'Şube', 'Satış (₺)', 'Zayi (₺)', 'Sayımı yapan', 'Saat']];
  days.filter(inM).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.branch < b.branch ? -1 : 1).forEach(d => {
    const ag = aggregate([d], d.day, d.day, 'all');
    gunluk.push([trDate(d.day), DAYS[dow(d.day)], bn(d.branch), d.base ? null : ag.soldTL, ag.wasteTL, d.worker, hhmm(d.at)]);
  });
  // Zayi kayıtları
  const sub = Object.fromEntries(data.submissions.map(s => [s.id, s]));
  const zayi = [['Tarih', 'Şube', 'Ürün', 'Boy', 'Miktar', 'Etiket', 'Neden', 'Not', 'Tutar (₺)']];
  data.waste.filter(w => sub[w.sid] && sub[w.sid].day >= first && sub[w.sid].day <= last && (w.kind || 'zayi') === 'zayi')
    .sort((a, b) => sub[a.sid].day < sub[b.sid].day ? -1 : 1)
    .forEach(w => zayi.push([trDate(sub[w.sid].day), bn(sub[w.sid].branch), (P(w.p) || {}).name || '#' + w.p, w.v != null ? 'Boy ' + w.v : '', +w.q, w.label || '', w.reason || '', w.note || '', +w.q * priceOf(w.p, w.v, sub[w.sid].day)]));
  const diger = [['Tarih', 'Şube', 'Tür', 'Ürün', 'Boy', 'Miktar', 'Not', 'Tutar (₺)']];
  data.waste.filter(w => sub[w.sid] && sub[w.sid].day >= first && sub[w.sid].day <= last && (w.kind || 'zayi') !== 'zayi')
    .sort((a, b) => sub[a.sid].day < sub[b.sid].day ? -1 : 1)
    .forEach(w => diger.push([trDate(sub[w.sid].day), bn(sub[w.sid].branch), kindName(w.kind), (P(w.p) || {}).name || '#' + w.p, w.v != null ? 'Boy ' + w.v : '', +w.q, w.note || '', +w.q * priceOf(w.p, w.v, sub[w.sid].day)]));
  const talep = [['Tarih', 'Saat', 'Şube', 'Çalışan', 'Ürün', 'Boy', 'İstenen', 'Not']];
  (data.misses || []).filter(m => m.day >= first && m.day <= last).sort((a, b) => a.at < b.at ? -1 : 1)
    .forEach(m => talep.push([trDate(m.day), hhmm(m.at), bn(m.branch), m.worker, (P(m.p) || {}).name || '#' + m.p, m.v != null ? 'Boy ' + m.v : '', +m.q, m.note || '']));
  // Sevkiyatlar
  const sevk = [['Tarih', 'Şube', 'Gönderen', 'Teslim alan', 'Ürün', 'Boy', 'Gönderilen', 'Gelen', 'Durum']];
  data.shipments.filter(s => s.day && s.day >= first && s.day <= last).sort((a, b) => a.sent_at < b.sent_at ? -1 : 1)
    .forEach(s => s.items.forEach(i => sevk.push([trDate(s.day), bn(s.branch), s.sent_by, s.confirmed_by || '', (P(i.p) || {}).name || '#' + i.p, i.v != null ? 'Boy ' + i.v : '', +i.sent, i.rec != null ? +i.rec : null, s.status === 'tamam' ? 'Tam' : s.status === 'eksik' ? 'Eksik' : 'Bekliyor'])));
  XLSX_MINI.download([
    { name: 'Özet', rows: [['Mevlana Pastaneleri — ' + ayAdi], ...ozet], head: [1], widths: [22, 16, 14, 16, 14, 18], money: [1, 2, 3], totalRow: ozet.length },
    { name: 'Ürünler', rows: urun, widths: [30, 8, 8, 11, 10, 14, 12, 12, 14], money: [3, 5, 7, 8] },
    { name: 'Şube-Ürün', rows: subeUrun, widths: [18, 30, 8, 10, 14, 12, 12], money: [4, 6] },
    { name: 'Günlük', rows: gunluk, widths: [12, 6, 18, 14, 12, 18, 8], money: [3, 4] },
    { name: 'Zayi kayıtları', rows: zayi, widths: [12, 18, 28, 8, 9, 10, 14, 20, 12], money: [8] },
    { name: 'Diğer çıkışlar', rows: diger, widths: [12, 18, 18, 28, 8, 9, 20, 12], money: [7] },
    { name: 'Müşteri talepleri', rows: talep, widths: [12, 7, 18, 16, 28, 8, 9, 24] },
    { name: 'Sevkiyatlar', rows: sevk, widths: [12, 18, 16, 16, 28, 8, 11, 9, 10] }
  ], `Mevlana-Stok-${ym}.xlsx`);
  toast(ayAdi + ' Excel dosyası indirildi');
}

/* ================= GİRİŞ ================= */
let picked = '', pickedName = '', typedName = '';
function viewLogin() {
  const acc = S.accounts || [];
  return `<main class="pad login">
    <img class="logo" src="logo.png" alt="Mevlana">
    <h1>Stok Takip</h1>
    <label>Şube</label>
    <div class="chips">${acc.filter(a => a.role !== 'admin').map(a => `<button class="chip ${picked === a.id ? 'on' : ''}" data-acc="${a.id}">${esc(a.name)}</button>`).join('')}</div>
    ${(() => { const wl = picked && picked !== 'admin' ? (S.wlist[picked] || []) : [];
      return wl.length ? `<label>Adınız</label><div class="chips">${wl.map(n => `<button class="chip ${pickedName === n ? 'on' : ''}" data-wname="${esc(n)}">${esc(n)}</button>`).join('')}</div>`
        : `<label for="w">${picked === 'admin' ? 'Kullanıcı adı' : 'Adınız'}</label><input id="w" class="inp" autocomplete="name" placeholder="${picked === 'admin' ? '' : 'Ad Soyad'}" value="${esc(typedName)}">`; })()}
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
      if (S.view !== 'sayim' || !SB.day) await SB.load();
      $app.innerHTML = S.view === 'sevk' ? sbSevk() : S.view === 'sayim' ? sbSayim() : S.view === 'ozet' ? sbOzet() : S.view === 'yok' ? sbYok() : sbMenu();
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
  const t = e.target.closest('button, [data-det]'); if (!t || t.disabled) return;
  const d = t.dataset, s = API.session;
  if (d.acc) {
    const w = document.getElementById('w'); if (w) typedName = w.value;
    picked = picked === d.acc && d.acc === 'admin' ? '' : d.acc; pickedName = '';
    if (picked && picked !== 'admin' && !(picked in S.wlist)) { try { S.wlist[picked] = await API.loginWorkers(picked); } catch { S.wlist[picked] = []; } }
    const pin = document.getElementById('pin')?.value || ''; await render(); const p2 = document.getElementById('pin'); if (p2) p2.value = pin; return;
  }
  if (d.wname) { pickedName = d.wname; document.querySelectorAll('[data-wname]').forEach(b => b.classList.toggle('on', b.dataset.wname === pickedName)); return; }
  if (d.grp) { S.open.has(d.grp) ? S.open.delete(d.grp) : S.open.add(d.grp); return rerenderList(); }
  if (d.go) return go(d.go);
  if (d.zero) {
    const dr = SB.draft(); let n = 0;
    for (const p of S.products.filter(p => p.active && p.grp === d.zero)) for (const v of variantsOf(p) || [null]) { const k = K(p.id, v); if (dr.kalan[k] == null) { dr.kalan[k] = 0; n++; } }
    SB.save(dr); toast(`${n} kalem 0 (rafta yok) yapıldı`); rerenderList(); updateProgress(); return;
  }
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
  if (d.cancel) {
    if (!confirm('Bu sevkiyat iptal edilsin mi? Şube artık görmeyecek.')) return;
    try { await API.cancelShipment(+d.cancel); toast('İptal edildi'); render(); } catch (x) { toast(x.message); }
    return;
  }
  if (d.editc || d.addc) {
    let k = d.editc, sid = +(d.sid || d.addc);
    if (!k) {
      const name = prompt('Hangi ürün? (adını yazın, ör. Tiramisu)'); if (!name) return;
      const m = S.products.filter(p => trLower(p.name) === trLower(name.trim()) || trLower(p.name).includes(trLower(name.trim())));
      if (!m.length) return toast('Ürün bulunamadı');
      const p = m[0], vs = variantsOf(p); let v = null;
      if (vs) { v = prompt(`${p.name} — hangi boy? (${vs.join(' / ')})`); if (v == null || !vs.includes(v.trim())) return toast('Boy seçilmedi'); v = v.trim(); }
      k = K(p.id, v);
    }
    const [pid, v] = splitK(k);
    const q = prompt(`${pname(pid, v)} — gün sonu kalan kaç olmalı? (0 = rafta yok)`, d.q || '');
    if (q == null) return;
    const n = parseFloat(String(q).replace(',', '.')); if (isNaN(n) || n < 0) return toast('Geçerli bir sayı yazın');
    try { await API.adminSetCount(sid, pid, v || '', n); await adLoad(true); toast('Düzeltildi'); render(); } catch (x) { toast(x.message); }
    return;
  }
  if (d.editw) {
    const q = prompt('Zayi miktarı kaç olmalı? (0 = sil)', d.q);
    if (q == null) return;
    const n = parseFloat(String(q).replace(',', '.')); if (isNaN(n) || n < 0) return toast('Geçerli bir sayı yazın');
    try { await API.adminSetWaste(+d.editw, n); await adLoad(true); toast('Düzeltildi'); render(); } catch (x) { toast(x.message); }
    return;
  }
  if (d.xls != null) {
    t.disabled = true; const old = t.textContent; t.textContent = 'Hazırlanıyor…';
    try { await exportMonth(+d.xls); } catch (x) { toast(x.message); }
    t.disabled = false; t.textContent = old; return;
  }
  if (d.wadd) {
    const n = prompt('Çalışanın adı:'); if (!n || !n.trim()) return;
    try { await API.adminWorkers('ekle', d.wadd, n.trim()); await adLoad(true); toast('Eklendi'); render(); } catch (x) { toast(x.message); }
    return;
  }
  if (d.wdel) {
    if (!confirm(`${d.n} listeden kaldırılsın mı?`)) return;
    try { await API.adminWorkers('sil', d.wdel, d.n); await adLoad(true); toast('Kaldırıldı'); render(); } catch (x) { toast(x.message); }
    return;
  }
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
        const nameEl = document.getElementById('w'), name = nameEl ? nameEl.value : pickedName;
        if (!name || !name.trim()) throw new Error('Adınızı seçin');
        await API.login(picked, name, document.getElementById('pin').value);
        AD.data = null; AD.audit = null; AD.detBranch = null; AD.detDay = null; SB.day = null;
        S.products = await API.products(); S.view = 'menu'; S.tab = 'bugun'; render();
      } catch (x) { err.textContent = x.message; t.disabled = false; t.textContent = 'Giriş'; }
      return;
    }
    case 'zayi': return openZayi();
    case 'miss': return openMiss();
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
      const dr = SB.draft();
      const act = S.products.filter(p => p.active), missing = slotsOf(act) - filledSlots(act, dr.kalan);
      const overN = Object.entries(dr.kalan).filter(([k, q]) => isOver(k, q)).length;
      if (overN && !confirm(`${overN} üründe sayı olağandışı görünüyor (dünkü kalan + bugün gelenden fazla). Yine de gönderilsin mi?`)) return;
      if (missing && !confirm(`${missing} kalem sayılmadı. Bunlar için satış hesaplanmayacak. Yine de gönderilsin mi?`)) return;
      if (!confirm('Sayım ve çıkışlar gönderilsin mi? Sonra değiştirilemez.')) return;
      const counts = Object.entries(dr.kalan).filter(([, q]) => q != null && q >= 0).map(([k, q]) => { const [p, v] = splitK(k); return { product_id: p, variant: v, qty: q }; });
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
    case 'audit': try { AD.audit = await API.adminAudit(); render(); } catch (x) { toast(x.message); } return;
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
