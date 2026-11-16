// Rotas adicionadas ao backend BRMove para chat e contato da corrida.
// O servidor principal fornece app, auth, h, q e bad.
module.exports = function registerChatRoutes(app, { auth, h, q, bad }) {
  // Contato liberado apenas aos dois participantes de uma corrida ativa.
  app.get('/orders/:id/contact', auth('client', 'driver'), h(async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) return bad(res, 'Corrida inválida');
    const r = await q(
      `SELECT o.id AS order_id, o.status,
         CASE WHEN o.client_id=$2 THEN du.name ELSE cu.name END AS name,
         CASE WHEN o.client_id=$2 THEN du.phone ELSE cu.phone END AS phone
       FROM orders o
       JOIN users cu ON cu.id=o.client_id
       LEFT JOIN users du ON du.id=o.driver_id
       WHERE o.id=$1 AND (o.client_id=$2 OR o.driver_id=$2)
         AND o.status IN ('accepted','picked_up')`,
      [orderId, req.user.id]
    );
    if (!r.rows[0]) return bad(res, 'Contato disponível somente durante uma corrida ativa', 404);
    res.json(r.rows[0]);
  }));

  app.get('/orders/:id/messages', auth('client', 'driver'), h(async (req, res) => {
    const orderId = Number(req.params.id);
    const after = req.query.after == null ? null : Number(req.query.after);
    if (!Number.isInteger(orderId) || orderId < 1) return bad(res, 'Corrida inválida');
    if (after !== null && (!Number.isSafeInteger(after) || after < 0)) {
      return bad(res, 'Marcador de mensagens inválido');
    }
    const active = await q(
      `SELECT id FROM orders WHERE id=$1 AND (client_id=$2 OR driver_id=$2)
         AND status IN ('accepted','picked_up')`,
      [orderId, req.user.id]
    );
    if (!active.rows[0]) return bad(res, 'Conversa disponível somente durante uma corrida ativa', 404);

    const sql = after === null
      ? `SELECT m.id,m.sender_id,u.name AS sender_name,m.message,m.created_at
         FROM order_messages m JOIN users u ON u.id=m.sender_id
         WHERE m.id IN (SELECT id FROM order_messages WHERE order_id=$1 ORDER BY id DESC LIMIT 100)
         ORDER BY m.id ASC`
      : `SELECT m.id,m.sender_id,u.name AS sender_name,m.message,m.created_at
         FROM order_messages m JOIN users u ON u.id=m.sender_id
         WHERE m.order_id=$1 AND m.id>$2 ORDER BY m.id ASC LIMIT 100`;
    const values = after === null ? [orderId] : [orderId, after];
    const messages = (await q(sql, values)).rows.map(m => ({
      ...m,
      is_mine: Number(m.sender_id) === Number(req.user.id),
    }));
    res.json(messages);
  }));

  app.post('/orders/:id/messages', auth('client', 'driver'), h(async (req, res) => {
    const orderId = Number(req.params.id);
    const message = String(req.body.message || '').trim();
    if (!Number.isInteger(orderId) || orderId < 1) return bad(res, 'Corrida inválida');
    if (!message || message.length > 1000) {
      return bad(res, 'A mensagem deve ter de 1 a 1000 caracteres');
    }
    const active = await q(
      `SELECT id FROM orders WHERE id=$1 AND (client_id=$2 OR driver_id=$2)
         AND status IN ('accepted','picked_up')`,
      [orderId, req.user.id]
    );
    if (!active.rows[0]) return bad(res, 'Conversa disponível somente durante uma corrida ativa', 404);

    // Limite simples para reduzir spam: no máximo 10 mensagens em 10 segundos.
    const recent = await q(
      `SELECT COUNT(*)::int AS total FROM order_messages
       WHERE order_id=$1 AND sender_id=$2 AND created_at > now() - interval '10 seconds'`,
      [orderId, req.user.id]
    );
    if (recent.rows[0].total >= 10) {
      return bad(res, 'Aguarde alguns segundos antes de enviar mais mensagens', 429);
    }

    const saved = await q(
      `INSERT INTO order_messages (order_id,sender_id,message)
       VALUES ($1,$2,$3) RETURNING id,sender_id,message,created_at`,
      [orderId, req.user.id, message]
    );
    res.status(201).json({
      ...saved.rows[0],
      sender_name: req.user.name,
      is_mine: true,
    });
  }));
};
