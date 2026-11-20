/* Supabase bağlantısı. Tablolara doğrudan erişim kapalı; her şey veritabanı fonksiyonlarından (RPC) geçer.
   Bu anahtar herkese açık olacak şekilde tasarlanmıştır (publishable). PIN'ler ve fiyat yetkisi sunucuda kontrol edilir. */
const API = (() => {
  const URL = 'https://eatdtawymhgxosgmhmzg.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_xj0lgsv_efaQOutJ398PXA_hGNFyxA_';
  const SKEY = 'mvs_session';

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { session = null; }

  async function call(fn, args = {}) {
    let res;
    try {
      res = await fetch(URL + fn, {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
    } catch {
      throw new Error('İnternet bağlantısı yok. Tekrar deneyin.');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && data.message) || 'Bir hata oluştu';
      if (msg === 'OTURUM_YOK') { setSession(null); location.reload(); }
      throw new Error(msg === 'YETKI_YOK' ? 'Bu işlem için yetkiniz yok' : msg);
    }
    return data;
  }

  function setSession(s) {
    session = s;
    try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch {}
  }

  const t = () => ({ p_token: session && session.token });

  return {
    get session() { return session; },
    accounts: () => call('login_accounts'),
    async login(account, worker, pin) {
      const s = await call('login', { p_account: account, p_worker: worker, p_pin: pin });
      if (s && s.error) throw new Error(s.error);
      setSession(s); return s;
    },
    async logout() { try { await call('logout', t()); } catch {} setSession(null); },
    products: () => call('get_products', t()),
    sendShipment: (branch, items) => call('send_shipment', { ...t(), p_branch: branch, p_items: items }),
    shipments: () => call('list_shipments', t()),
    confirmShipment: (id, items) => call('confirm_shipment', { ...t(), p_id: id, p_items: items }),
    submitDay: (counts, waste) => call('submit_day', { ...t(), p_counts: counts, p_waste: waste }),
    myDay: () => call('my_day', t()),
    addCorrection: body => call('add_correction', { ...t(), p_body: body }),
    adminData: (from, to) => call('admin_data', { ...t(), p_from: from, p_to: to }),
    adminPhoto: id => call('admin_photo', { ...t(), p_waste_id: id }),
    adminSetPin: (acc, pin) => call('admin_set_pin', { ...t(), p_account: acc, p_pin: pin }),
    adminSaveProduct: p => call('admin_save_product', { ...t(), p }),
    adminSetCorrection: (id, st) => call('admin_set_correction', { ...t(), p_id: id, p_status: st }),
    adminSetCount: (sid, pid, v, q) => call('admin_set_count', { ...t(), p_sid: sid, p_product: pid, p_variant: v, p_qty: q }),
    adminSetWaste: (id, q) => call('admin_set_waste', { ...t(), p_id: id, p_qty: q }),
    cancelShipment: id => call('cancel_shipment', { ...t(), p_id: id })
  };
})();
