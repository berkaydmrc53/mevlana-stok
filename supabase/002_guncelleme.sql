-- 2. güncelleme: PIN deneme kilidi, yönetici düzeltmesi, sevkiyat iptali, gece kontrolü
create table if not exists login_attempts (
  id bigserial primary key,
  account_id text not null,
  at timestamptz not null default now()
);
alter table login_attempts enable row level security;
revoke all on login_attempts from anon, authenticated;

create or replace function login(p_account text, p_worker text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a accounts; t uuid; fails int;
begin
  if coalesce(trim(p_worker),'') = '' then raise exception 'Adınızı yazın'; end if;
  select count(*) into fails from login_attempts where account_id = p_account and at > now() - interval '15 minutes';
  if fails >= 5 then return json_build_object('error', 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.'); end if;
  select * into a from accounts where id = p_account;
  if a.id is null or a.pin_hash <> crypt(p_pin, a.pin_hash)
     or (a.role = 'admin' and lower(trim(p_worker)) <> lower(a.name)) then
    insert into login_attempts(account_id) values (coalesce(p_account, '?'));
    delete from login_attempts where at < now() - interval '1 day';
    perform pg_sleep(1);
    -- hata fırlatmak yerine döndür: böylece hatalı deneme kaydı silinmez
    return json_build_object('error', 'PIN hatalı');
  end if;
  delete from login_attempts where account_id = a.id;
  insert into sessions(account_id, worker) values (a.id, trim(p_worker)) returning token into t;
  return json_build_object('token', t, 'account', a.id, 'name', a.name, 'role', a.role, 'worker', trim(p_worker), 'today', biz_day());
end $$;

-- Yönetici: gün sonu kalanı düzelt (0 = sil)
create or replace function admin_set_count(p_token uuid, p_sid bigint, p_product int, p_variant text, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_token, array['admin']);
  delete from count_items where submission_id = p_sid and product_id = p_product and variant is not distinct from nullif(p_variant,'');
  if p_qty > 0 then
    insert into count_items(submission_id, product_id, variant, qty) values (p_sid, p_product, nullif(p_variant,''), p_qty);
  end if;
end $$;

-- Yönetici: zayi miktarını düzelt (0 = sil)
create or replace function admin_set_waste(p_token uuid, p_id bigint, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_token, array['admin']);
  if p_qty > 0 then update waste_items set qty = p_qty where id = p_id;
  else delete from waste_items where id = p_id; end if;
end $$;

-- İmalathane/yönetici: teslim alınmamış sevkiyatı iptal et
create or replace function cancel_shipment(p_token uuid, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s shipments;
begin
  perform _need(p_token, array['imalathane','admin']);
  select * into s from shipments where id = p_id;
  if s.id is null then raise exception 'Sevkiyat bulunamadı'; end if;
  if s.status <> 'bekliyor' then raise exception 'Şube teslim aldığı için iptal edilemez'; end if;
  delete from shipments where id = p_id;
end $$;

-- Gece kontrolü: bugün sayım girmeyen şubelerin adları (fiyat/rakam yok)
create or replace function missing_counts() returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(a.name order by a.sort), '[]') from accounts a
  where a.role = 'sube' and not exists (select 1 from submissions s where s.branch_id = a.id and s.day = biz_day())
$$;

-- Yetkiler: sadece bu fonksiyonlar dışarı açık
revoke all on function admin_set_count(uuid,bigint,int,text,numeric), admin_set_waste(uuid,bigint,numeric),
  cancel_shipment(uuid,bigint), missing_counts() from public, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant execute on function login(text,text,text), admin_set_count(uuid,bigint,int,text,numeric), admin_set_waste(uuid,bigint,numeric),
  cancel_shipment(uuid,bigint), missing_counts() to anon;
select 'tamam' as sonuc;
