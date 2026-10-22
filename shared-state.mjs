import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function authorizedUser() {
  const user = await getUser();
  if (!user?.email) return { error: json({ error: 'Silakan login terlebih dahulu.' }, 401) };
  const allowed = (process.env.ALLOWED_EMAILS || '')
    .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return { error: json({ error: 'Admin belum mengatur ALLOWED_EMAILS di Netlify.' }, 503) };
  if (!allowed.includes(user.email.toLowerCase())) return { error: json({ error: 'Akun ini tidak diizinkan mengakses ruang Rencana Kita.' }, 403) };
  return { user };
}

export default async (req) => {
  if (!['GET', 'PUT'].includes(req.method)) return json({ error: 'Metode tidak didukung.' }, 405);
  try {
    const auth = await authorizedUser();
    if (auth.error) return auth.error;
    const db = getDatabase();
    if (req.method === 'GET') {
      const rows = await db.sql`SELECT payload, revision, updated_at FROM shared_app_state WHERE id = 'ghazy-putri' LIMIT 1`;
      if (!rows.length) return json({ payload: null, revision: 0 });
      return json({ payload: rows[0].payload, revision: Number(rows[0].revision), updatedAt: rows[0].updated_at });
    }
    const body = await req.json();
    if (!body || !body.payload || !Array.isArray(body.payload.plans) || !Number.isInteger(body.expectedRevision)) {
      return json({ error: 'Format data tidak valid.' }, 400);
    }
    const payload = JSON.stringify(body.payload);
    if (body.expectedRevision === 0) {
      const inserted = await db.sql`INSERT INTO shared_app_state (id, payload, revision, updated_at) VALUES ('ghazy-putri', ${payload}::jsonb, 1, NOW()) ON CONFLICT (id) DO NOTHING RETURNING payload, revision`;
      if (!inserted.length) return json({ error: 'Data sudah dibuat dari perangkat lain. Muat ulang halaman untuk mengambil data terbaru.' }, 409);
      return json({ payload: inserted[0].payload, revision: Number(inserted[0].revision) });
    }
    const updated = await db.sql`UPDATE shared_app_state SET payload = ${payload}::jsonb, revision = revision + 1, updated_at = NOW() WHERE id = 'ghazy-putri' AND revision = ${body.expectedRevision} RETURNING payload, revision`;
    if (!updated.length) return json({ error: 'Ada perubahan dari perangkat lain. Muat ulang halaman untuk menghindari menimpa data.' }, 409);
    return json({ payload: updated[0].payload, revision: Number(updated[0].revision) });
  } catch (error) {
    console.error('shared-state error', error);
    return json({ error: 'Terjadi kendala server. Periksa konfigurasi Netlify Identity dan Database.' }, 500);
  }
};

export const config = { path: '/api/shared-state' };
