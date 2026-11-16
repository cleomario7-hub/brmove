# BRMove - Backend (etapa 1)

API em Node.js + PostgreSQL para o sistema de entregas BRMove.

## Como rodar

1. Instale Node 18+ e PostgreSQL, e crie o banco: `createdb brmove`
2. Copie `.env.example` para `.env` e ajuste os valores
3. `npm install`
4. `npm run migrate` (cria tabelas, preços iniciais e o usuário admin)
5. `npm run dev`

## Rotas principais

| Perfil | Rota | Função |
|---|---|---|
| todos | POST /auth/register, /auth/login | cadastro e login (JWT) |
| cliente | POST /quotes | preço por veículo |
| cliente | POST /orders | criar pedido |
| cliente | GET /orders/mine | meus pedidos |
| cliente | POST /orders/:id/cancel, /rate | cancelar e avaliar |
| cliente | GET /orders/:id/tracking | posição do motorista |
| motorista | POST /driver/online, /driver/location | ficar online, enviar posição |
| motorista | GET /orders/available | corridas disponíveis |
| motorista | POST /orders/:id/accept, /status | aceitar, coletado, entregue |
| admin | GET /admin/drivers, POST /admin/drivers/:id/approve | aprovar motoristas |
| admin | GET /admin/orders, GET/PUT /admin/pricing | corridas e tabela de preços |

Enviar o token em todas as rotas protegidas: `Authorization: Bearer <token>`.

## Exemplo de pedido

```json
POST /orders
{
  "vehicle_type": "moto",
  "pickup":  { "address": "Rua A, 10", "lat": -15.7939, "lng": -47.8828 },
  "dropoff": { "address": "Rua B, 20", "lat": -15.8267, "lng": -47.9218 },
  "notes": "Entregar na portaria"
}
```

## Próximas etapas

App do cliente, app do motorista, painel admin, pagamentos e notificações.
