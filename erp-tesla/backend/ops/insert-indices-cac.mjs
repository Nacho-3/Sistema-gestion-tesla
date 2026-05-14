import { pool } from '../db.js';

const indices = [
  { periodo: 'ENE 2024', valor: 6011.70 },
  { periodo: 'FEB 2024', valor: 6851.60 },
  { periodo: 'MAR 2024', valor: 6851.60 },
  { periodo: 'ABR 2024', valor: 7803.50 },
  { periodo: 'MAY 2024', valor: 8657.90 },
  { periodo: 'JUN 2024', valor: 9608.30 },
  { periodo: 'JUL 2024', valor: 9608.30 },
  { periodo: 'AGO 2024', valor: 10084.90 },
  { periodo: 'SEPT 2024', valor: 10483.30 },
  { periodo: 'OCT 2024', valor: 10899.20 },
  { periodo: 'NOV 2024', valor: 11624.10 },
  { periodo: 'DIC 2024', valor: 12089.70 },
  { periodo: 'ENE 2025', valor: 12319.90 },
  { periodo: 'FEB 2025', valor: 12752.30 },
  { periodo: 'MAR 2025', valor: 12877.80 },
  { periodo: 'ABR 2025', valor: 12755.30 },
  { periodo: 'MAY 2025', valor: 13334.90 },
  { periodo: 'JUN 2025', valor: 13443.50 },
  { periodo: 'JUL 2025', valor: 13711.80 },
  { periodo: 'AGO 2025', valor: 13812.60 },
  { periodo: 'SEPT 2025', valor: 14207.50 },
  { periodo: 'OCT 2025', valor: 14408.80 },
  { periodo: 'NOV 2025', valor: 14839.90 },
  { periodo: 'DIC 2025', valor: 15026.20 },
  { periodo: 'ENE 2026', valor: 15444.40 },
  { periodo: 'FEB 2026', valor: 15708.20 },
  { periodo: 'MAR 2026', valor: 16205.20 },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Evitar duplicados: eliminar registros existentes con el mismo período
  const periodos = indices.map(i => i.periodo);
  await client.query(
    `DELETE FROM indices_cac WHERE periodo = ANY($1)`,
    [periodos]
  );

  for (const { periodo, valor } of indices) {
    await client.query(
      `INSERT INTO indices_cac (periodo, valor, notas) VALUES ($1, $2, $3)`,
      [periodo, valor, 'Mano de Obra CAC']
    );
    console.log(`  ✓ ${periodo}: ${valor}`);
  }

  await client.query('COMMIT');
  console.log(`\n✅ ${indices.length} índices insertados correctamente.`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('❌ Error — se hizo rollback:', err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
