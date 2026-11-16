require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('Defina JWT_SECRET no .env');

const VEHICLES = ['moto', 'carro', 'van', 'caminhao'];
const app = express();
app.use(cors());
app.use(express.json());

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- utilidades ----------
function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const validPoint = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

// distância em linha reta x 1,3 para aproximar o trajeto por ruas
function roadKm(a, b) { return Math.round(haversineKm(a, b) * 1.3 * 100) / 100; }

function priceFor(row, km) {
  const raw = Number(row.base_fare) + Number(row.per_km) * km;
  return Math.round(Math.max(Number(row.min_fare), raw) * 100) / 100;
}

function auth(...roles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    try {
      req.user = jwt.verify(token, SECRET);
    } catch {
      return bad(res, 'Não autenticado', 401);
    }
    if (roles.length && !roles.includes(req.user.role)) return bad(res, 'Sem permissão', 403);
    next();
  };
}
const sign = (u) =>
  jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '30d' });

// ---------- autenticação ----------
app.post('/auth/register', h(async (req, res) => {
  const { name, email, phone, password, role, vehicle_type, plate } = req.body;
  if (!name || !email || !password || password.length < 6) return bad(res, 'Dados inválidos');
  if (!['client', 'driver'].includes(role)) return bad(res, 'Perfil inválido');
  if (role === 'driver' && (!VEHICLES.includes(vehicle_type) || !plate)) {
    return bad(res, 'Informe veículo e placa');
  }
  const hash = await bcrypt.hash(password, 10);
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const u = await conn.query(
      `INSERT INTO users (name,email,phone,password_hash,role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,name,role`,
      [name, email.toLowerCase(), phone || null, hash, role]
    );
    if (role === 'driver') {
      await conn.query(
        'INSERT INTO drivers (user_id, vehicle_type, plate) VALUES ($1,$2,$3)',
        [u.rows[0].id, vehicle_type, plate.toUpperCase()]
      );
    }
    await conn.query('COMMIT');
    res.status(201).json({ token: sign(u.rows[0]), user: u.rows[0] });
  } catch (e) {
    await conn.query('ROLLBACK');
    if (e.code === '23505') return bad(res, 'E-mail já cadastrado', 409);
    throw e;
  } finally {
    conn.release();
  }
}));

app.post('/auth/login', h(async (req, res) => {
  const { email, password } = req.body;
  const r = await q('SELECT * FROM users WHERE email=$1', [String(email || '').toLowerCase()]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    return bad(res, 'E-mail ou senha incorretos', 401);
  }
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role } });
}));

// ---------- cotação e pedidos (cliente) ----------
app.post('/quotes', auth('client'), h(async (req, res) => {
  const { pickup, dropoff } = req.body;
  if (!validPoint(pickup) || !validPoint(dropoff)) return bad(res, 'Coordenadas inválidas');
  const km = roadKm(pickup, dropoff);
  const rows = (await q('SELECT * FROM pricing')).rows;
  res.json({
    distance_km: km,
    options: rows.map((r) => ({ vehicle_type: r.vehicle_type, price: priceFor(r, km) })),
  });
}));

app.post('/orders', auth('client'), h(async (req, res) => {
  const { vehicle_type, pickup, dropoff, notes } = req.body;
  if (!VEHICLES.includes(vehicle_type)) return bad(res, 'Veículo inválido');
  if (!validPoint(pickup) || !validPoint(dropoff) || !pickup.address || !dropoff.address) {
    return bad(res, 'Endereços e coordenadas são obrigatórios');
  }
  const km = roadKm(pickup, dropoff);
  const p = (await q('SELECT * FROM pricing WHERE vehicle_type=$1', [vehicle_type])).rows[0];
  const r = await q(
    `INSERT INTO orders (client_id,vehicle_type,pickup_address,pickup_lat,pickup_lng,
       dropoff_address,dropoff_lat,dropoff_lng,notes,distance_km,price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.user.id, vehicle_type, pickup.address, pickup.lat, pickup.lng,
     dropoff.address, dropoff.lat, dropoff.lng, notes || null, km, priceFor(p, km)]
  );
  res.status(201).json(r.rows[0]);
}));

app.get('/orders/mine', auth('client', 'driver'), h(async (req, res) => {
  const col = req.user.role === 'client' ? 'client_id' : 'driver_id';
  const r = await q(`SELECT * FROM orders WHERE ${col}=$1 ORDER BY created_at DESC`, [req.user.id]);
  res.json(r.rows);
}));

app.post('/orders/:id/cancel', auth('client'), h(async (req, res) => {
  const r = await q(
    `UPDATE orders SET status='cancelled', updated_at=now()
     WHERE id=$1 AND client_id=$2 AND status IN ('pending','accepted') RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!r.rows[0]) return bad(res, 'Pedido não pode ser cancelado', 409);
  res.json(r.rows[0]);
}));

app.post('/orders/:id/rate', auth('client'), h(async (req, res) => {
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad(res, 'Nota de 1 a 5');
  const r = await q(
    `UPDATE orders SET rating=$1, updated_at=now()
     WHERE id=$2 AND client_id=$3 AND status='delivered' RETURNING *`,
    [rating, req.params.id, req.user.id]
  );
  if (!r.rows[0]) return bad(res, 'Só é possível avaliar entregas concluídas', 409);
  res.json(r.rows[0]);
}));

// ---------- motorista ----------
app.post('/driver/online', auth('driver'), h(async (req, res) => {
  const { online, lat, lng } = req.body;
  const d = (await q('SELECT approved FROM drivers WHERE user_id=$1', [req.user.id])).rows[0];
  if (!d || !d.approved) return bad(res, 'Cadastro ainda não aprovado', 403);
  await q('UPDATE drivers SET online=$1, lat=COALESCE($2,lat), lng=COALESCE($3,lng) WHERE user_id=$4',
    [!!online, lat ?? null, lng ?? null, req.user.id]);
  res.json({ online: !!online });
}));

app.post('/driver/location', auth('driver'), h(async (req, res) => {
  const { lat, lng } = req.body;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad(res, 'Coordenadas inválidas');
  await q('UPDATE drivers SET lat=$1, lng=$2 WHERE user_id=$3', [lat, lng, req.user.id]);
  res.json({ ok: true });
}));

app.get('/orders/available', auth('driver'), h(async (req, res) => {
  const d = (await q('SELECT * FROM drivers WHERE user_id=$1', [req.user.id])).rows[0];
  if (!d || !d.approved || !d.online) return res.json([]);
  const r = await q(
    `SELECT * FROM orders WHERE status='pending' AND vehicle_type=$1
     ORDER BY created_at ASC LIMIT 50`,
    [d.vehicle_type]
  );
  res.json(r.rows);
}));

app.post('/orders/:id/accept', auth('driver'), h(async (req, res) => {
  const d = (await q('SELECT * FROM drivers WHERE user_id=$1', [req.user.id])).rows[0];
  if (!d || !d.approved) return bad(res, 'Cadastro ainda não aprovado', 403);
  // atualização atômica: só um motorista consegue aceitar
  const r = await q(
    `UPDATE orders SET driver_id=$1, status='accepted', updated_at=now()
     WHERE id=$2 AND status='pending' AND vehicle_type=$3 RETURNING *`,
    [req.user.id, req.params.id, d.vehicle_type]
  );
  if (!r.rows[0]) return bad(res, 'Pedido indisponível', 409);
  res.json(r.rows[0]);
}));

const NEXT = { accepted: 'picked_up', picked_up: 'delivered' };
app.post('/orders/:id/status', auth('driver'), h(async (req, res) => {
  const { status } = req.body;
  const cur = (await q('SELECT * FROM orders WHERE id=$1 AND driver_id=$2',
    [req.params.id, req.user.id])).rows[0];
  if (!cur) return bad(res, 'Pedido não encontrado', 404);
  if (NEXT[cur.status] !== status) return bad(res, 'Transição de status inválida', 409);
  const r = await q('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [status, cur.id]);
  res.json(r.rows[0]);
}));

// rastreio: o cliente consulta a posição do motorista do pedido dele
app.get('/orders/:id/tracking', auth('client'), h(async (req, res) => {
  const r = await q(
    `SELECT o.status, d.lat, d.lng, u.name AS driver_name, d.plate, d.vehicle_type
     FROM orders o
     JOIN drivers d ON d.user_id = o.driver_id
     JOIN users u ON u.id = d.user_id
     WHERE o.id=$1 AND o.client_id=$2`,
    [req.params.id, req.user.id]
  );
  if (!r.rows[0]) return bad(res, 'Sem motorista designado', 404);
  res.json(r.rows[0]);
}));

// ---------- admin ----------
app.get('/admin/drivers', auth('admin'), h(async (req, res) => {
  const r = await q(
    `SELECT u.id,u.name,u.email,u.phone,d.vehicle_type,d.plate,d.approved,d.online
     FROM drivers d JOIN users u ON u.id=d.user_id ORDER BY u.created_at DESC`);
  res.json(r.rows);
}));

app.post('/admin/drivers/:id/approve', auth('admin'), h(async (req, res) => {
  const r = await q('UPDATE drivers SET approved=$1 WHERE user_id=$2 RETURNING user_id,approved',
    [req.body.approved !== false, req.params.id]);
  if (!r.rows[0]) return bad(res, 'Motorista não encontrado', 404);
  res.json(r.rows[0]);
}));

app.get('/admin/orders', auth('admin'), h(async (req, res) => {
  const r = await q('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200');
  res.json(r.rows);
}));

app.get('/admin/pricing', auth('admin'), h(async (req, res) => {
  res.json((await q('SELECT * FROM pricing ORDER BY base_fare')).rows);
}));

app.put('/admin/pricing/:vehicle', auth('admin'), h(async (req, res) => {
  const { base_fare, per_km, min_fare } = req.body;
  if (![base_fare, per_km, min_fare].every((n) => Number.isFinite(n) && n >= 0)) {
    return bad(res, 'Valores inválidos');
  }
  const r = await q(
    `UPDATE pricing SET base_fare=$1, per_km=$2, min_fare=$3 WHERE vehicle_type=$4 RETURNING *`,
    [base_fare, per_km, min_fare, req.params.vehicle]
  );
  if (!r.rows[0]) return bad(res, 'Veículo não encontrado', 404);
  res.json(r.rows[0]);
}));

// ---------- básico ----------
app.get('/health', (req, res) => res.json({ ok: true, app: 'BRMove' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`BRMove API rodando na porta ${port}`));
