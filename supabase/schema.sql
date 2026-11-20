-- Mevlana Stok Takip — veritabanı şeması
create extension if not exists pgcrypto with schema extensions;

create table if not exists accounts (
  id text primary key,
  name text not null,
  role text not null check (role in ('sube','imalathane','admin')),
  pin_hash text not null,
  sort int not null default 0
);

create table if not exists products (
  id serial primary key,
  grp text not null,
  name text not null,
  unit text not null default 'Adet',
  prices jsonb not null default '{}'::jsonb,
  shelf_days int,
  active boolean not null default true,
  sort int not null default 0,
  note text
);

create table if not exists sessions (
  token uuid primary key default gen_random_uuid(),
  account_id text not null references accounts(id) on delete cascade,
  worker text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days'
);

create table if not exists shipments (
  id bigserial primary key,
  branch_id text not null references accounts(id),
  sent_by text not null,
  sent_at timestamptz not null default now(),
  status text not null default 'bekliyor' check (status in ('bekliyor','tamam','eksik')),
  confirmed_by text,
  confirmed_at timestamptz
);

create table if not exists shipment_items (
  id bigserial primary key,
  shipment_id bigint not null references shipments(id) on delete cascade,
  product_id int not null references products(id),
  variant text,
  qty_sent numeric not null check (qty_sent > 0),
  qty_received numeric
);

create table if not exists submissions (
  id bigserial primary key,
  branch_id text not null references accounts(id),
  day date not null,
  worker text not null,
  created_at timestamptz not null default now(),
  unique (branch_id, day)
);

create table if not exists count_items (
  id bigserial primary key,
  submission_id bigint not null references submissions(id) on delete cascade,
  product_id int not null references products(id),
  variant text,
  qty numeric not null
);

create table if not exists waste_items (
  id bigserial primary key,
  submission_id bigint not null references submissions(id) on delete cascade,
  product_id int not null references products(id),
  variant text,
  qty numeric not null,
  label text,
  reason text,
  note text,
  photo text
);

create table if not exists corrections (
  id bigserial primary key,
  branch_id text not null references accounts(id),
  worker text not null,
  body text not null,
  created_at timestamptz not null default now(),
  status text not null default 'bekliyor' check (status in ('bekliyor','yapildi','reddedildi'))
);

-- Tablolara doğrudan erişim yok: her şey aşağıdaki fonksiyonlardan geçer.
alter table accounts enable row level security;
alter table products enable row level security;
alter table sessions enable row level security;
alter table shipments enable row level security;
alter table shipment_items enable row level security;
alter table submissions enable row level security;
alter table count_items enable row level security;
alter table waste_items enable row level security;
alter table corrections enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- İş günü: gece 05:00'e kadar önceki gün sayılır (Türkiye saati)
create or replace function biz_day(t timestamptz default now()) returns date
language sql stable as $$ select ((t at time zone 'Europe/Istanbul') - interval '5 hours')::date $$;

-- Oturum kontrolü
create or replace function _sess(p_token uuid, p_roles text[] default null)
returns table(account_id text, role text, worker text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select s.account_id, a.role, s.worker from sessions s join accounts a on a.id = s.account_id
    where s.token = p_token and s.expires_at > now();
  if not found then raise exception 'OTURUM_YOK' using hint = 'Lütfen tekrar giriş yapın'; end if;
end $$;

create or replace function _need(p_token uuid, p_roles text[])
returns table(account_id text, role text, worker text)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _sess(p_token);
  if not (r.role = any(p_roles)) then raise exception 'YETKI_YOK'; end if;
  account_id := r.account_id; role := r.role; worker := r.worker;
  return next;
end $$;

-- Giriş ekranı için hesap listesi (PIN yok)
create or replace function login_accounts() returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'name', name, 'role', role) order by sort), '[]') from accounts
$$;

create or replace function login(p_account text, p_worker text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a accounts; t uuid;
begin
  if coalesce(trim(p_worker),'') = '' then raise exception 'Adınızı yazın'; end if;
  select * into a from accounts where id = p_account;
  if a.id is null or a.pin_hash <> crypt(p_pin, a.pin_hash) then
    perform pg_sleep(1);
    raise exception 'PIN hatalı';
  end if;
  if a.role = 'admin' and lower(trim(p_worker)) <> lower(a.name) then
    perform pg_sleep(1);
    raise exception 'PIN hatalı';
  end if;
  insert into sessions(account_id, worker) values (a.id, trim(p_worker)) returning token into t;
  return json_build_object('token', t, 'account', a.id, 'name', a.name, 'role', a.role, 'worker', trim(p_worker), 'today', biz_day());
end $$;

create or replace function logout(p_token uuid) returns void
language sql security definer set search_path = public as $$ delete from sessions where token = p_token $$;

-- Ürünler (fiyat sadece yöneticiye)
create or replace function get_products(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _sess(p_token);
  return (select coalesce(json_agg(json_build_object(
      'id', id, 'grp', grp, 'name', name, 'unit', unit, 'shelf_days', shelf_days, 'active', active, 'sort', sort,
      'prices', case when r.role = 'admin' then prices else null end,
      'note', case when r.role = 'admin' then note else null end
    ) order by sort, id), '[]')
    from products where active or r.role = 'admin');
end $$;

-- İMALATHANE: sevkiyat gönder
create or replace function send_shipment(p_token uuid, p_branch text, p_items jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record; sid bigint;
begin
  select * into r from _need(p_token, array['imalathane','admin']);
  if not exists (select 1 from accounts where id = p_branch and role = 'sube') then raise exception 'Şube bulunamadı'; end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then raise exception 'Ürün seçilmedi'; end if;
  insert into shipments(branch_id, sent_by) values (p_branch, r.worker) returning id into sid;
  insert into shipment_items(shipment_id, product_id, variant, qty_sent)
    select sid, (x->>'product_id')::int, nullif(x->>'variant',''), (x->>'qty')::numeric
    from jsonb_array_elements(p_items) x where (x->>'qty')::numeric > 0;
  return sid;
end $$;

-- Sevkiyat listesi: imalathane kendi gönderdiklerini (son 7 gün), şube kendi bekleyenlerini görür
create or replace function list_shipments(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _sess(p_token);
  return (select coalesce(json_agg(row_to_json(z) order by z.sent_at desc), '[]') from (
    select s.id, s.branch_id, b.name as branch_name, s.sent_by, s.sent_at, s.status, s.confirmed_by, s.confirmed_at,
      (select json_agg(json_build_object('id', i.id, 'product_id', i.product_id, 'variant', i.variant,
          'qty_sent', i.qty_sent, 'qty_received', i.qty_received) order by i.id)
         from shipment_items i where i.shipment_id = s.id) as items
    from shipments s join accounts b on b.id = s.branch_id
    where (r.role = 'sube' and s.branch_id = r.account_id and (s.status = 'bekliyor' or biz_day(s.confirmed_at) = biz_day()))
       or (r.role in ('imalathane','admin') and s.sent_at > now() - interval '7 days')
  ) z);
end $$;

-- ŞUBE: sevkiyatı teslim al
create or replace function confirm_shipment(p_token uuid, p_id bigint, p_items jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare r record; s shipments; short boolean;
begin
  select * into r from _need(p_token, array['sube']);
  select * into s from shipments where id = p_id for update;
  if s.id is null or s.branch_id <> r.account_id then raise exception 'Sevkiyat bulunamadı'; end if;
  if s.status <> 'bekliyor' then raise exception 'Bu sevkiyat zaten teslim alındı'; end if;
  update shipment_items i set qty_received = greatest(0, coalesce((
      select (x->>'qty')::numeric from jsonb_array_elements(p_items) x where (x->>'id')::bigint = i.id), i.qty_sent))
    where i.shipment_id = p_id;
  select exists(select 1 from shipment_items where shipment_id = p_id and qty_received < qty_sent) into short;
  update shipments set status = case when short then 'eksik' else 'tamam' end,
    confirmed_by = r.worker, confirmed_at = now() where id = p_id;
  return case when short then 'eksik' else 'tamam' end;
end $$;

-- ŞUBE: gün sonu sayım + zayi tek seferde onay (sonra değiştirilemez)
create or replace function submit_day(p_token uuid, p_counts jsonb, p_waste jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare r record; sid bigint; d date := biz_day();
begin
  select * into r from _need(p_token, array['sube']);
  if exists (select 1 from submissions where branch_id = r.account_id and day = d) then
    raise exception 'Bugünün sayımı zaten onaylandı';
  end if;
  insert into submissions(branch_id, day, worker) values (r.account_id, d, r.worker) returning id into sid;
  insert into count_items(submission_id, product_id, variant, qty)
    select sid, (x->>'product_id')::int, nullif(x->>'variant',''), (x->>'qty')::numeric
    from jsonb_array_elements(coalesce(p_counts,'[]')) x where (x->>'qty')::numeric > 0;
  insert into waste_items(submission_id, product_id, variant, qty, label, reason, note, photo)
    select sid, (x->>'product_id')::int, nullif(x->>'variant',''), (x->>'qty')::numeric,
      x->>'label', x->>'reason', nullif(x->>'note',''), nullif(x->>'photo','')
    from jsonb_array_elements(coalesce(p_waste,'[]')) x where (x->>'qty')::numeric > 0;
  return json_build_object('id', sid, 'day', d);
end $$;

-- ŞUBE: bugünkü onaylı kayıt (sadece kendi şubesi, sadece bugün)
create or replace function my_day(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r record; s submissions;
begin
  select * into r from _need(p_token, array['sube']);
  select * into s from submissions where branch_id = r.account_id and day = biz_day();
  if s.id is null then return json_build_object('day', biz_day(), 'submitted', false); end if;
  return json_build_object('day', s.day, 'submitted', true, 'worker', s.worker, 'at', s.created_at,
    'counts', (select coalesce(json_agg(json_build_object('product_id', product_id, 'variant', variant, 'qty', qty)), '[]') from count_items where submission_id = s.id),
    'waste', (select coalesce(json_agg(json_build_object('product_id', product_id, 'variant', variant, 'qty', qty, 'label', label, 'reason', reason, 'note', note)), '[]') from waste_items where submission_id = s.id),
    'corrections', (select coalesce(json_agg(json_build_object('body', body, 'at', created_at, 'status', status) order by created_at), '[]')
                    from corrections where branch_id = r.account_id and biz_day(created_at) = biz_day()));
end $$;

create or replace function add_correction(p_token uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _need(p_token, array['sube','imalathane']);
  if coalesce(trim(p_body),'') = '' then raise exception 'Açıklama yazın'; end if;
  insert into corrections(branch_id, worker, body) values (r.account_id, r.worker, trim(p_body));
end $$;

-- YÖNETİCİ: ham veriler (rapor hesapları uygulamada yapılır)
create or replace function admin_data(p_token uuid, p_from date, p_to date) returns json
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _need(p_token, array['admin']);
  return json_build_object(
    'accounts', (select json_agg(json_build_object('id', id, 'name', name, 'role', role) order by sort) from accounts),
    'submissions', (select coalesce(json_agg(json_build_object('id', id, 'branch', branch_id, 'day', day, 'worker', worker, 'at', created_at)), '[]')
                    from submissions where day between p_from - 21 and p_to),
    'counts', (select coalesce(json_agg(json_build_object('sid', c.submission_id, 'p', c.product_id, 'v', c.variant, 'q', c.qty)), '[]')
               from count_items c join submissions s on s.id = c.submission_id where s.day between p_from - 21 and p_to),
    'waste', (select coalesce(json_agg(json_build_object('id', w.id, 'sid', w.submission_id, 'p', w.product_id, 'v', w.variant, 'q', w.qty,
                  'label', w.label, 'reason', w.reason, 'note', w.note, 'photo', w.photo is not null)), '[]')
              from waste_items w join submissions s on s.id = w.submission_id where s.day between p_from - 21 and p_to),
    'shipments', (select coalesce(json_agg(json_build_object('id', s.id, 'branch', s.branch_id, 'sent_by', s.sent_by, 'sent_at', s.sent_at,
                  'status', s.status, 'confirmed_by', s.confirmed_by, 'confirmed_at', s.confirmed_at, 'day', biz_day(s.confirmed_at),
                  'items', (select json_agg(json_build_object('p', i.product_id, 'v', i.variant, 'sent', i.qty_sent, 'rec', i.qty_received)) from shipment_items i where i.shipment_id = s.id))), '[]')
                  from shipments s where s.status = 'bekliyor' or biz_day(s.confirmed_at) between p_from - 21 and p_to),
    'corrections', (select coalesce(json_agg(json_build_object('id', id, 'branch', branch_id, 'worker', worker, 'body', body, 'at', created_at, 'status', status) order by created_at desc), '[]')
                    from corrections where status = 'bekliyor' or created_at > now() - interval '30 days')
  );
end $$;

create or replace function admin_photo(p_token uuid, p_waste_id bigint) returns text
language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['admin']); return (select photo from waste_items where id = p_waste_id); end $$;

create or replace function admin_set_pin(p_token uuid, p_account text, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _need(p_token, array['admin']);
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN 4 haneli rakam olmalı'; end if;
  update accounts set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_account;
  delete from sessions where account_id = p_account and account_id <> 'admin';
end $$;

create or replace function admin_save_product(p_token uuid, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare nid int;
begin
  perform _need(p_token, array['admin']);
  if (p->>'id') is null then
    insert into products(grp, name, unit, prices, shelf_days, active, sort)
    values (p->>'grp', p->>'name', coalesce(nullif(p->>'unit',''),'Adet'), coalesce(p->'prices','{}'),
            nullif(p->>'shelf_days','')::int, true, coalesce((select max(sort)+1 from products), 0))
    returning id into nid;
    return nid;
  end if;
  update products set
    prices = coalesce(p->'prices', prices),
    shelf_days = case when p ? 'shelf_days' then nullif(p->>'shelf_days','')::int else shelf_days end,
    active = coalesce((p->>'active')::boolean, active)
  where id = (p->>'id')::int;
  return (p->>'id')::int;
end $$;

create or replace function admin_set_correction(p_token uuid, p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['admin']); update corrections set status = p_status where id = p_id; end $$;

-- Sadece fonksiyonlar dışarı açık
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function login_accounts(), login(text,text,text), logout(uuid), get_products(uuid),
  send_shipment(uuid,text,jsonb), list_shipments(uuid), confirm_shipment(uuid,bigint,jsonb),
  submit_day(uuid,jsonb,jsonb), my_day(uuid), add_correction(uuid,text),
  admin_data(uuid,date,date), admin_photo(uuid,bigint), admin_set_pin(uuid,text,text),
  admin_save_product(uuid,jsonb), admin_set_correction(uuid,bigint,text)
  to anon;
