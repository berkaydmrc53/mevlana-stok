-- 3. güncelleme: sayıldı/sayılmadı, çıkış türleri, müşteri talebi, değişiklik kaydı,
-- fiyat geçmişi, olağandışı sayı kontrolü, çalışan listesi
-- Mevcut veriler korunur; eski sayımlar "v2 = false" olarak işaretli kalır.

-- 1) Sayıldı / sayılmadı: v2 sayımlarda 0 da kaydedilir, kaydı olmayan ürün "sayılmadı" demektir
alter table submissions add column if not exists v2 boolean not null default false;

-- 2) Çıkış türleri (zayi, personel, ikram, imalathaneye iade, müşteri iadesi)
alter table waste_items add column if not exists kind text not null default 'zayi';
do $$ begin
  alter table waste_items add constraint waste_kind_chk check (kind in ('zayi','personel','ikram','imalathane_iade','musteri_iade'));
exception when duplicate_object then null; end $$;

-- 3) Müşteri istedi, yoktu
create table if not exists demand_misses (
  id bigserial primary key,
  branch_id text not null references accounts(id),
  day date not null,
  worker text not null,
  product_id int not null references products(id),
  variant text,
  qty numeric not null check (qty > 0),
  note text,
  created_at timestamptz not null default now()
);

-- 4) Değişiklik kaydı (silinemez, değiştirilemez)
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text,
  old_value jsonb,
  new_value jsonb,
  note text
);

-- 5) Fiyat geçmişi
create table if not exists price_history (
  id bigserial primary key,
  product_id int not null references products(id),
  prices jsonb not null,
  valid_from date not null,
  created_at timestamptz not null default now()
);
insert into price_history(product_id, prices, valid_from)
  select id, prices, date '2000-01-01' from products
  where not exists (select 1 from price_history h where h.product_id = products.id);

-- 7) Çalışan listesi
create table if not exists workers (
  id bigserial primary key,
  account_id text not null references accounts(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique (account_id, name)
);

alter table demand_misses enable row level security;
alter table audit_log enable row level security;
alter table price_history enable row level security;
alter table workers enable row level security;
revoke all on demand_misses, audit_log, price_history, workers from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create or replace function _audit(p_actor text, p_action text, p_target text, p_old jsonb, p_new jsonb, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log(actor, action, target, old_value, new_value, note) values (p_actor, p_action, p_target, p_old, p_new, p_note)
$$;

-- Giriş: çalışan listesi tanımlıysa ad listeden olmalı
create or replace function login_workers(p_account text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(name order by name), '[]') from workers where account_id = p_account and active
$$;

create or replace function login(p_account text, p_worker text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a accounts; t uuid; fails int;
begin
  if coalesce(trim(p_worker),'') = '' then raise exception 'Adınızı seçin'; end if;
  select count(*) into fails from login_attempts where account_id = p_account and at > now() - interval '15 minutes';
  if fails >= 5 then return json_build_object('error', 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.'); end if;
  select * into a from accounts where id = p_account;
  if a.id is null or a.pin_hash <> crypt(p_pin, a.pin_hash)
     or (a.role = 'admin' and lower(trim(p_worker)) <> lower(a.name)) then
    insert into login_attempts(account_id) values (coalesce(p_account, '?'));
    delete from login_attempts where at < now() - interval '1 day';
    perform pg_sleep(1);
    return json_build_object('error', 'PIN hatalı');
  end if;
  if a.role <> 'admin' and exists (select 1 from workers where account_id = a.id and active)
     and not exists (select 1 from workers where account_id = a.id and active and name = trim(p_worker)) then
    return json_build_object('error', 'Bu isim listede yok. Yöneticiye eklettirin.');
  end if;
  delete from login_attempts where account_id = a.id;
  insert into sessions(account_id, worker) values (a.id, trim(p_worker)) returning token into t;
  return json_build_object('token', t, 'account', a.id, 'name', a.name, 'role', a.role, 'worker', trim(p_worker), 'today', biz_day());
end $$;

-- Şube: gün sonu (0'lar da kaydedilir, çıkış türü ile)
create or replace function submit_day(p_token uuid, p_counts jsonb, p_waste jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare r record; sid bigint; d date := biz_day();
begin
  select * into r from _need(p_token, array['sube']);
  if exists (select 1 from submissions where branch_id = r.account_id and day = d) then
    raise exception 'Bugünün sayımı zaten onaylandı';
  end if;
  insert into submissions(branch_id, day, worker, v2) values (r.account_id, d, r.worker, true) returning id into sid;
  insert into count_items(submission_id, product_id, variant, qty)
    select sid, (x->>'product_id')::int, nullif(x->>'variant',''), (x->>'qty')::numeric
    from jsonb_array_elements(coalesce(p_counts,'[]')) x where (x->>'qty')::numeric >= 0;
  insert into waste_items(submission_id, product_id, variant, qty, label, reason, note, photo, kind)
    select sid, (x->>'product_id')::int, nullif(x->>'variant',''), (x->>'qty')::numeric,
      x->>'label', x->>'reason', nullif(x->>'note',''), nullif(x->>'photo',''),
      case when x->>'kind' in ('zayi','personel','ikram','imalathane_iade','musteri_iade') then x->>'kind' else 'zayi' end
    from jsonb_array_elements(coalesce(p_waste,'[]')) x where (x->>'qty')::numeric > 0;
  return json_build_object('id', sid, 'day', d);
end $$;

create or replace function my_day(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r record; s submissions;
begin
  select * into r from _need(p_token, array['sube']);
  select * into s from submissions where branch_id = r.account_id and day = biz_day();
  if s.id is null then return json_build_object('day', biz_day(), 'submitted', false,
    'misses', (select coalesce(json_agg(json_build_object('product_id', product_id, 'variant', variant, 'qty', qty, 'note', note, 'at', created_at) order by created_at), '[]')
               from demand_misses where branch_id = r.account_id and day = biz_day())); end if;
  return json_build_object('day', s.day, 'submitted', true, 'worker', s.worker, 'at', s.created_at,
    'counts', (select coalesce(json_agg(json_build_object('product_id', product_id, 'variant', variant, 'qty', qty)), '[]') from count_items where submission_id = s.id),
    'waste', (select coalesce(json_agg(json_build_object('product_id', product_id, 'variant', variant, 'qty', qty, 'label', label, 'reason', reason, 'note', note, 'kind', kind)), '[]') from waste_items where submission_id = s.id),
    'misses', (select coalesce(json_agg(json_build_object('product_id', product_id, 'variant', variant, 'qty', qty, 'note', note, 'at', created_at) order by created_at), '[]')
               from demand_misses where branch_id = r.account_id and day = biz_day()),
    'corrections', (select coalesce(json_agg(json_build_object('body', body, 'at', created_at, 'status', status) order by created_at), '[]')
                    from corrections where branch_id = r.account_id and biz_day(created_at) = biz_day()));
end $$;

-- Şube: müşteri istedi, yoktu
create or replace function add_miss(p_token uuid, p_product int, p_variant text, p_qty numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _need(p_token, array['sube']);
  if not exists (select 1 from products where id = p_product) then raise exception 'Ürün bulunamadı'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'Miktar girin'; end if;
  insert into demand_misses(branch_id, day, worker, product_id, variant, qty, note)
  values (r.account_id, biz_day(), r.worker, p_product, nullif(p_variant,''), p_qty, nullif(trim(coalesce(p_note,'')),''));
end $$;

-- Şube: sayımda olağandışı değer kontrolü için ürün başına "rafta olabilecek en fazla" miktar
-- (son sayımdaki kalan + o sayımdan sonra teslim alınan). Fiyat içermez.
create or replace function my_expected(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r record; s submissions;
begin
  select * into r from _need(p_token, array['sube']);
  select * into s from submissions where branch_id = r.account_id and day < biz_day() order by day desc limit 1;
  if s.id is null then return json_build_object('has_prev', false, 'items', '[]'::json); end if;
  return json_build_object('has_prev', true, 'items', (select coalesce(json_agg(json_build_object('product_id', p, 'variant', v, 'max', m)), '[]') from (
    select p, v, sum(q) m from (
      select product_id p, variant v, qty q from count_items where submission_id = s.id
      union all
      select i.product_id, i.variant, coalesce(i.qty_received, i.qty_sent) from shipment_items i join shipments sh on sh.id = i.shipment_id
      where sh.branch_id = r.account_id and sh.status <> 'bekliyor' and sh.confirmed_at > s.created_at
    ) z group by p, v) g));
end $$;

-- Yönetici: ham veriler (yeni alanlarla)
create or replace function admin_data(p_token uuid, p_from date, p_to date) returns json
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _need(p_token, array['admin']);
  return json_build_object(
    'accounts', (select json_agg(json_build_object('id', id, 'name', name, 'role', role) order by sort) from accounts),
    'submissions', (select coalesce(json_agg(json_build_object('id', id, 'branch', branch_id, 'day', day, 'worker', worker, 'at', created_at, 'v2', v2)), '[]')
                    from submissions where day between p_from - 21 and p_to),
    'counts', (select coalesce(json_agg(json_build_object('sid', c.submission_id, 'p', c.product_id, 'v', c.variant, 'q', c.qty)), '[]')
               from count_items c join submissions s on s.id = c.submission_id where s.day between p_from - 21 and p_to),
    'waste', (select coalesce(json_agg(json_build_object('id', w.id, 'sid', w.submission_id, 'p', w.product_id, 'v', w.variant, 'q', w.qty,
                  'label', w.label, 'reason', w.reason, 'note', w.note, 'photo', w.photo is not null, 'kind', w.kind)), '[]')
              from waste_items w join submissions s on s.id = w.submission_id where s.day between p_from - 21 and p_to),
    'shipments', (select coalesce(json_agg(json_build_object('id', s.id, 'branch', s.branch_id, 'sent_by', s.sent_by, 'sent_at', s.sent_at,
                  'status', s.status, 'confirmed_by', s.confirmed_by, 'confirmed_at', s.confirmed_at, 'day', biz_day(s.confirmed_at),
                  'items', (select json_agg(json_build_object('p', i.product_id, 'v', i.variant, 'sent', i.qty_sent, 'rec', i.qty_received)) from shipment_items i where i.shipment_id = s.id))), '[]')
                  from shipments s where s.status = 'bekliyor' or biz_day(s.confirmed_at) between p_from - 21 and p_to),
    'corrections', (select coalesce(json_agg(json_build_object('id', id, 'branch', branch_id, 'worker', worker, 'body', body, 'at', created_at, 'status', status) order by created_at desc), '[]')
                    from corrections where status = 'bekliyor' or created_at > now() - interval '30 days'),
    'misses', (select coalesce(json_agg(json_build_object('branch', branch_id, 'day', day, 'worker', worker, 'p', product_id, 'v', variant, 'q', qty, 'note', note, 'at', created_at)), '[]')
               from demand_misses where day between p_from - 21 and p_to),
    'prices', (select coalesce(json_agg(json_build_object('p', product_id, 'prices', prices, 'from', valid_from) order by product_id, valid_from), '[]') from price_history),
    'workers', (select coalesce(json_agg(json_build_object('id', id, 'account', account_id, 'name', name) order by account_id, name), '[]') from workers where active)
  );
end $$;

-- Yönetici fonksiyonları (değişiklik kaydı ile)
create or replace function admin_set_count(p_token uuid, p_sid bigint, p_product int, p_variant text, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare r record; old numeric; s submissions;
begin
  select * into r from _need(p_token, array['admin']);
  select * into s from submissions where id = p_sid;
  if s.id is null then raise exception 'Sayım bulunamadı'; end if;
  select qty into old from count_items where submission_id = p_sid and product_id = p_product and variant is not distinct from nullif(p_variant,'');
  delete from count_items where submission_id = p_sid and product_id = p_product and variant is not distinct from nullif(p_variant,'');
  if p_qty >= 0 then
    insert into count_items(submission_id, product_id, variant, qty) values (p_sid, p_product, nullif(p_variant,''), p_qty);
  end if;
  perform _audit(r.worker, 'kalan_duzeltme', s.branch_id || ' ' || s.day || ' ürün ' || p_product || coalesce(' boy ' || nullif(p_variant,''), ''),
    to_jsonb(old), to_jsonb(p_qty));
end $$;

create or replace function admin_set_waste(p_token uuid, p_id bigint, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare r record; w waste_items; s submissions;
begin
  select * into r from _need(p_token, array['admin']);
  select * into w from waste_items where id = p_id;
  if w.id is null then raise exception 'Kayıt bulunamadı'; end if;
  select * into s from submissions where id = w.submission_id;
  if p_qty > 0 then update waste_items set qty = p_qty where id = p_id;
  else delete from waste_items where id = p_id; end if;
  perform _audit(r.worker, w.kind || '_duzeltme', s.branch_id || ' ' || s.day || ' ürün ' || w.product_id || coalesce(' boy ' || w.variant, ''),
    to_jsonb(w.qty), to_jsonb(p_qty));
end $$;

create or replace function cancel_shipment(p_token uuid, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r record; s shipments;
begin
  select * into r from _need(p_token, array['imalathane','admin']);
  select * into s from shipments where id = p_id;
  if s.id is null then raise exception 'Sevkiyat bulunamadı'; end if;
  if s.status <> 'bekliyor' then raise exception 'Şube teslim aldığı için iptal edilemez'; end if;
  perform _audit(r.worker, 'sevkiyat_iptal', s.branch_id || ' sevkiyat #' || s.id,
    (select jsonb_agg(jsonb_build_object('urun', product_id, 'boy', variant, 'adet', qty_sent)) from shipment_items where shipment_id = p_id), null);
  delete from shipments where id = p_id;
end $$;

create or replace function admin_set_pin(p_token uuid, p_account text, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  select * into r from _need(p_token, array['admin']);
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN 4 haneli rakam olmalı'; end if;
  update accounts set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_account;
  delete from sessions where account_id = p_account and account_id <> 'admin';
  perform _audit(r.worker, 'pin_degisti', p_account, null, null, 'PIN değeri kaydedilmez');
end $$;

create or replace function admin_save_product(p_token uuid, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; nid int; old products;
begin
  select * into r from _need(p_token, array['admin']);
  if (p->>'id') is null then
    insert into products(grp, name, unit, prices, shelf_days, active, sort)
    values (p->>'grp', p->>'name', coalesce(nullif(p->>'unit',''),'Adet'), coalesce(p->'prices','{}'),
            nullif(p->>'shelf_days','')::int, true, coalesce((select max(sort)+1 from products), 0))
    returning id into nid;
    insert into price_history(product_id, prices, valid_from) values (nid, coalesce(p->'prices','{}'), date '2000-01-01');
    perform _audit(r.worker, 'urun_eklendi', p->>'name', null, p);
    return nid;
  end if;
  select * into old from products where id = (p->>'id')::int;
  update products set
    prices = coalesce(p->'prices', prices),
    shelf_days = case when p ? 'shelf_days' then nullif(p->>'shelf_days','')::int else shelf_days end,
    active = coalesce((p->>'active')::boolean, active)
  where id = old.id;
  if p ? 'prices' and (p->'prices') is distinct from old.prices then
    delete from price_history where product_id = old.id and valid_from = biz_day();
    insert into price_history(product_id, prices, valid_from) values (old.id, p->'prices', biz_day());
    perform _audit(r.worker, 'fiyat_degisti', old.name, old.prices, p->'prices', 'Geçerlilik: ' || biz_day());
  end if;
  if p ? 'shelf_days' and nullif(p->>'shelf_days','')::int is distinct from old.shelf_days then
    perform _audit(r.worker, 'raf_omru_degisti', old.name, to_jsonb(old.shelf_days), p->'shelf_days');
  end if;
  if p ? 'active' and (p->>'active')::boolean is distinct from old.active then
    perform _audit(r.worker, case when (p->>'active')::boolean then 'urun_satisa_alindi' else 'urun_kaldirildi' end, old.name, null, null);
  end if;
  return old.id;
end $$;

create or replace function admin_set_correction(p_token uuid, p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; c corrections;
begin
  select * into r from _need(p_token, array['admin']);
  select * into c from corrections where id = p_id;
  update corrections set status = p_status where id = p_id;
  perform _audit(r.worker, 'talep_' || p_status, c.branch_id || ': ' || left(c.body, 80), to_jsonb(c.status), to_jsonb(p_status));
end $$;

create or replace function admin_workers(p_token uuid, p_action text, p_account text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _need(p_token, array['admin']);
  if coalesce(trim(p_name),'') = '' then raise exception 'İsim yazın'; end if;
  if p_action = 'ekle' then
    insert into workers(account_id, name) values (p_account, trim(p_name))
      on conflict (account_id, name) do update set active = true;
  else
    update workers set active = false where account_id = p_account and name = trim(p_name);
  end if;
  perform _audit(r.worker, 'calisan_' || p_action, p_account || ': ' || trim(p_name), null, null);
end $$;

create or replace function admin_audit(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_token, array['admin']);
  return (select coalesce(json_agg(row_to_json(a) order by a.at desc), '[]') from
    (select at, actor, action, target, old_value, new_value, note from audit_log order by at desc limit 200) a);
end $$;

-- Yetkiler
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function login_accounts(), login_workers(text), login(text,text,text), logout(uuid), get_products(uuid),
  send_shipment(uuid,text,jsonb), list_shipments(uuid), confirm_shipment(uuid,bigint,jsonb),
  submit_day(uuid,jsonb,jsonb), my_day(uuid), add_correction(uuid,text), add_miss(uuid,int,text,numeric,text), my_expected(uuid),
  admin_data(uuid,date,date), admin_photo(uuid,bigint), admin_set_pin(uuid,text,text),
  admin_save_product(uuid,jsonb), admin_set_correction(uuid,bigint,text),
  admin_set_count(uuid,bigint,int,text,numeric), admin_set_waste(uuid,bigint,numeric), cancel_shipment(uuid,bigint),
  admin_workers(uuid,text,text,text), admin_audit(uuid), missing_counts()
  to anon;
select 'tamam' as sonuc;
