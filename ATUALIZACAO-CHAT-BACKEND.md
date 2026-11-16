# Atualização do chat na API BRMove

Os apps usam a API que já está publicada em `https://api.fretesbsb.com.br`.
O complemento de chat está em `brmove-backend/src/chat-routes.js` e a migração SQL em
`brmove-backend/src/chat-migration.sql`.

**Importante:** o `brmove-backend/src/server.js` que veio neste repositório é uma versão
mais antiga que os apps. Ele não contém diversas rotas já utilizadas no ambiente atual
(por exemplo, recursos de carteira, perfil, dispositivos e pagamentos). Não substitua
o servidor de produção inteiro por esse arquivo antigo.

Para integrar somente o chat no backend que já está funcionando:

1. Faça backup do servidor atual e do banco PostgreSQL.
2. Copie `chat-routes.js` para a pasta `src/` do backend ativo.
3. Depois que `app`, `auth`, `h`, `q` e `bad` estiverem definidos, registre as rotas com:

   ```js
   require('./chat-routes')(app, { auth, h, q, bad });
   ```

4. Execute `chat-migration.sql` no mesmo banco PostgreSQL utilizado pela API.
5. Reinicie a API e teste com uma corrida aceita.

O chat consulta mensagens a cada 3 segundos enquanto a tela da conversa está aberta.
Este complemento não altera o sistema de notificações existente.
