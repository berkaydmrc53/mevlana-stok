# Mevlana Stok Takip

Mevlana Pastaneleri şubeleri için stok, sevkiyat ve zayi takip uygulaması.

- **Şube:** imalathaneden gelen sevkiyatı teslim alır, gün sonu kalanı sayar, zayiyi girer ve onaylar.
- **İmalathane:** şubelere gönderilen ürünleri girer.
- **Yönetici:** bütün şubelerin satış, zayi ve sevkiyat raporlarını görür, PIN ve fiyatları yönetir.

Veriler Supabase'de tutulur. Tablolara doğrudan erişim kapalıdır; uygulama sadece veritabanı fonksiyonlarını çağırır
(`supabase/schema.sql`). Fiyatlar ve raporlar yalnızca yönetici oturumuna döner.

Satış hesabı: `önceki gün kalan + gelen − bugün kalan − zayi`.
