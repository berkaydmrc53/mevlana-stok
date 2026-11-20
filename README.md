# Mevlana Stok Takip

Mevlana Pastaneleri şubeleri için stok, sevkiyat ve zayi takip uygulaması.

- **Şube:** imalathaneden gelen sevkiyatı teslim alır, gün sonu kalanı sayar, zayiyi girer ve onaylar.
- **İmalathane:** şubelere gönderilen ürünleri girer.
- **Yönetici:** bütün şubelerin satış, zayi ve sevkiyat raporlarını görür, PIN ve fiyatları yönetir.

Veriler Supabase'de tutulur. Tablolara doğrudan erişim kapalıdır; uygulama sadece veritabanı fonksiyonlarını çağırır
(`supabase/schema.sql`). Fiyatlar ve raporlar yalnızca yönetici oturumuna döner.

Satış hesabı: `önceki gün kalan + gelen − bugün kalan − zayi`.

## Gece kontrolü
`.github/workflows/gece-kontrol.yml` her gece 23:30'da (TR) sayım girmeyen şubeleri ntfy ile yöneticiye bildirir.
Aynı çalışma ücretsiz Supabase projesinin uykuya geçmesini de engeller.

## Veritabanı güncellemeleri
`supabase/schema.sql` ilk kurulum, `supabase/002_guncelleme.sql` PIN kilidi, düzeltme ve iptal fonksiyonları.
