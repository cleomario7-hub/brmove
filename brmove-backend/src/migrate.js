require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    const prices = [
      ['moto', 5, 1.8, 8],
      ['carro', 9, 2.6, 15],
      ['van', 18, 3.8, 35],
      ['caminhao', 40, 6.5, 90],
    ];
    for (const [v, base, km, min] of prices) {
      await pool.query(
        `INSERT INTO pricing (vehicle_type, base_fare, per_km, min_fare)
         VALUES ($1,$2,$3,$4) ON CONFLICT (vehicle_type) DO NOTHING`,
        [v, base, km, min]
      );
    }

    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('Administrador', $1, $2, 'admin') ON CONFLICT (email) DO NOTHING`,
        [process.env.ADMIN_EMAIL.toLowerCase(), hash]
      );
    }
    console.log('Migração concluída.');
  } catch (e) {
    console.error('Erro na migração:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
