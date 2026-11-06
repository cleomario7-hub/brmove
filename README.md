# BRMove - App do cliente (Android)

Web app empacotado com Capacitor. A API fica em https://api.fretesbsb.com.br
(constante `API` no início do script de `www/index.html`).

## Gerar o APK pelo GitHub

1. Crie um repositório no GitHub e envie TODOS os arquivos desta pasta,
   incluindo a pasta oculta `.github`.
2. Abra a aba **Actions**, rode **Build APK** (ou faça um push na branch main).
3. Ao terminar, baixe o artefato `brmove-apk` e instale o `app-debug.apk` no celular.

## Testar no navegador

Abra `www/index.html` direto no navegador do computador.

## Observação

Os endereços são convertidos em coordenadas pelo OpenStreetMap (gratuito, bom para
testes). Para produção, trocar por Google Maps ou Mapbox.
