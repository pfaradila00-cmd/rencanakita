# Rencana Kita — versi online Netlify

Tampilan dan fitur multi-rencana dari aplikasi Rencana Kita dipertahankan. Versi ini menambahkan login Netlify Identity, satu ruang bersama Ghazy & Putri, penyimpanan di Netlify Database (Postgres), dan polling sinkronisasi sekitar setiap 5 detik.

## Penting sebelum deploy

- Netlify Database tersedia pada paket Netlify berbasis credits; penggunaan database memakai credits untuk compute dan bandwidth.
- Login membutuhkan situs yang sudah dideploy di Netlify dengan HTTPS. Jangan menguji alur Identity hanya dengan membuka `index.html` langsung.
- File ini adalah paket proyek yang perlu dihubungkan ke akun/site Netlify Anda. Database dan akun pengguna belum dibuat karena hal itu memerlukan akses ke dashboard Netlify Anda.
- Backend hanya mengizinkan alamat email yang tercantum di environment variable `ALLOWED_EMAILS`.

## Langkah pemasangan

1. Ekstrak ZIP ini dan unggah folder proyek ke repositori GitHub.
2. Di Netlify, pilih **Add new project → Import an existing project** lalu hubungkan repositori tersebut.
3. Pastikan build command `npm run build`, publish directory `dist`, Node.js 22.
4. Di Netlify project, buka **Data & Storage → Database** lalu buat database jika belum otomatis dibuat. Deploy menjalankan migration `netlify/database/migrations/0001_create_shared_app_state.sql`.
5. Buka **Project configuration → Identity** dan aktifkan Netlify Identity. Atur pendaftaran menjadi **Invite only**.
6. Di Identity → Users, undang dua email yang akan digunakan oleh Ghazy dan Putri. Mereka akan menerima email untuk menyelesaikan pembuatan akun.
7. Di **Project configuration → Environment variables**, buat `ALLOWED_EMAILS` dengan nilai dua email yang sama, dipisahkan koma, contoh `ghazy@example.com,putri@example.com`. Jangan menggunakan contoh ini sebagai email sungguhan.
8. Deploy ulang setelah mengatur environment variable. Login dari URL situs Netlify di masing-masing perangkat.

## Data lama

Saat login pertama kali, jika database masih kosong, aplikasi mencoba menyalin data multi-rencana yang ada di localStorage browser yang pertama login. Jika browser itu belum pernah memakai versi lama, data contoh akan diunggah. Pastikan perangkat yang berisi data paling lengkap digunakan untuk login pertama. Setelah data online ada, database menjadi sumber utama dan akan menimpa data lokal pada perangkat baru.

## Sinkronisasi dan konflik

Aplikasi memeriksa perubahan dari perangkat pasangan kira-kira setiap 5 detik. Jika kedua pengguna mengedit pada waktu yang hampir bersamaan, penyimpanan versi yang lebih lama ditolak untuk mencegah menimpa data terbaru; muat ulang halaman untuk mengambil versi server. Hindari mengedit record yang sama bersamaan.

## Keamanan

- `ALLOWED_EMAILS` divalidasi di Netlify Function, bukan di browser.
- Semua query database berjalan di Function; tidak ada kredensial database di frontend.
- Jangan pernah memasukkan password atau token rahasia ke file HTML atau repositori.
- Simpan salinan ekspor/cadangan sebelum migrasi data penting.
