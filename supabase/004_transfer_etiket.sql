-- 4. güncelleme: şubeler arası transfer ve gün etiketi
-- Transfer, sevkiyat tablosunu kullanır: from_branch dolu ise gönderen bir şubedir (boşsa imalathane).

alter table shipments add column if not exists from_branch text references accounts(id);

create table if not exists day_tags (
  day date primary key,
  tag text not null check (tag in ('normal','kotu_hava','ozel_gun','resmi_tatil')),
  note text,
  updated_at timestamptz not null default now()
);
alter table day_tags enable row level security;
revoke all on day_tags from anon, authenticated;

-- Şube: başka şubeye ürün gönder
create or replace function send_transfer(p_token uuid, p_to text, p_items jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record; sid bigint;
begin
  select * into r from _need(p_token, array['sube']);
  if p_to = r.account_id then raise exception 'Kendi şubenize gönderemezsiniz'; end if;
  if not exists (select 1 from accounts where id = p_to and role = 'sube') then raise exception 'Şube bulunamadı'; end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then raise exception 'Ürün seçilmedi'; end if;
  insert into shipments(branch_id, sent_by, from_branch) values (p_to, r.worker, r.account_id) returning id into sid;
  insert into shipment_items(shipment_id, product_id, variant, qty_sent)
    select sid, (x->>'product_id')::int, nullif(x->>'variant',''), (x->>'qty')::numeric
    from jsonb_array_elements(p_items) x where (x->>'qty')::numeric > 0;
  return sid;
end $$;

-- Sevkiyat listesi: şube gelenleri + bugün gönderdiği transferleri; imalathane yalnızca kendi gönderdiklerini görür
create or replace function list_shipments(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from _sess(p_token);
  return (select coalesce(json_agg(row_to_json(z) order by z.sent_at desc), '[]') from (
    select s.id, s.branch_id, b.name as branch_name, s.from_branch, f.name as from_name, s.sent_by, s.sent_at, s.status, s.confirmed_by, s.confirmed_at,
      (select json_agg(json_build_object('id', i.id, 'product_id', i.product_id, 'variant', i.variant,
          'qty_sent', i.qty_sent, 'qty_received', i.qty_received) order by i.id)
         from shipment_items i where i.shipment_id = s.id) as items
    from shipments s join accounts b on b.id = s.branch_id left join accounts f on f.id = s.from_branch
    where (r.role = 'sube' and s.branch_id = r.account_id and (s.status = 'bekliyor' or biz_day(s.confirmed_at) = biz_day()))
       or (r.role = 'sube' and s.from_branch = r.account_id and (s.status = 'bekliyor' or biz_day(s.sent_at) = biz_day()))
       or (r.role = 'imalathane' and s.from_branch is null and s.sent_at > now() - interval '7 days')
       or (r.role = 'admin' and s.sent_at > now() - interval '7 days')
  ) z);
end $$;

-- İptal: imalathane kendi gönderdiğini, şube kendi transferini (teslim alınmadıysa)
create or replace function cancel_shipment(p_token uuid, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r record; s shipments;
begin
  select * into r from _need(p_token, array['imalathane','admin','sube']);
  select * into s from shipments where id = p_id;
  if s.id is null then raise exception 'Sevkiyat bulunamadı'; end if;
  if r.role = 'sube' and s.from_branch is distinct from r.account_id then raise exception 'Bu sevkiyatı iptal edemezsiniz'; end if;
  if r.role = 'imalathane' and s.from_branch is not null then raise exception 'Bu sevkiyatı iptal edemezsiniz'; end if;
  if s.status <> 'bekliyor' then raise exception 'Teslim alındığı için iptal edilemez'; end if;
  perform _audit(r.worker, 'sevkiyat_iptal', coalesce(s.from_branch, 'imalathane') || ' → ' || s.branch_id || ' sevkiyat #' || s.id,
    (select jsonb_agg(jsonb_build_object('urun', product_id, 'boy', variant, 'adet', qty_sent)) from shipment_items where shipment_id = p_id), null);
  delete from shipments where id = p_id;
end $$;

-- Rafta olabilecek en fazla: son kalan + gelen − gönderilen transfer
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
      union all
      select i.product_id, i.variant, -i.qty_sent from shipment_items i join shipments sh on sh.id = i.shipment_id
      where sh.from_branch = r.account_id and sh.sent_at > s.created_at
    ) z group by p, v) g));
end $$;

-- Yönetici: gün etiketi (boş = sil)
create or replace function admin_set_day_tag(p_token uuid, p_day date, p_tag text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; old text;
begin
  select * into r from _need(p_token, array['admin']);
  select tag into old from day_tags where day = p_day;
  if coalesce(p_tag,'') = '' then delete from day_tags where day = p_day;
  else insert into day_tags(day, tag) values (p_day, p_tag) on conflict (day) do update set tag = excluded.tag, updated_at = now(); end if;
  perform _audit(r.worker, 'gun_etiketi', p_day::text, to_jsonb(old), to_jsonb(nullif(p_tag,'')));
end $$;

-- Yönetici: ham veriler (transfer ve gün etiketleriyle)
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
    'shipments', (select coalesce(json_agg(json_build_object('id', s.id, 'branch', s.branch_id, 'from', s.from_branch, 'sent_by', s.sent_by, 'sent_at', s.sent_at,
                  'sent_day', biz_day(s.sent_at), 'status', s.status, 'confirmed_by', s.confirmed_by, 'confirmed_at', s.confirmed_at, 'day', biz_day(s.confirmed_at),
                  'items', (select json_agg(json_build_object('p', i.product_id, 'v', i.variant, 'sent', i.qty_sent, 'rec', i.qty_received)) from shipment_items i where i.shipment_id = s.id))), '[]')
                  from shipments s where s.status = 'bekliyor' or biz_day(s.confirmed_at) between p_from - 21 and p_to or biz_day(s.sent_at) between p_from - 21 and p_to),
    'corrections', (select coalesce(json_agg(json_build_object('id', id, 'branch', branch_id, 'worker', worker, 'body', body, 'at', created_at, 'status', status) order by created_at desc), '[]')
                    from corrections where status = 'bekliyor' or created_at > now() - interval '30 days'),
    'misses', (select coalesce(json_agg(json_build_object('branch', branch_id, 'day', day, 'worker', worker, 'p', product_id, 'v', variant, 'q', qty, 'note', note, 'at', created_at)), '[]')
               from demand_misses where day between p_from - 21 and p_to),
    'prices', (select coalesce(json_agg(json_build_object('p', product_id, 'prices', prices, 'from', valid_from) order by product_id, valid_from), '[]') from price_history),
    'workers', (select coalesce(json_agg(json_build_object('id', id, 'account', account_id, 'name', name) order by account_id, name), '[]') from workers where active),
    'day_tags', (select coalesce(json_agg(json_build_object('day', day, 'tag', tag)), '[]') from day_tags where day between p_from - 21 and p_to)
  );
end $$;

revoke all on function send_transfer(uuid,text,jsonb), admin_set_day_tag(uuid,date,text) from public, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant execute on function send_transfer(uuid,text,jsonb), admin_set_day_tag(uuid,date,text), list_shipments(uuid),
  cancel_shipment(uuid,bigint), my_expected(uuid), admin_data(uuid,date,date) to anon;
select 'tamam' as sonuc;
