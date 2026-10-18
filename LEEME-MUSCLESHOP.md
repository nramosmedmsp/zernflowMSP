# CRM Muscle Shop (sobre ZernFlow)

Este repositorio es el fork de [zernio-dev/zernflow](https://github.com/zernio-dev/zernflow) que usamos como
CRM de Muscle Shop: bandeja de conversaciones, contactos con etiquetas, flujos automáticos y difusiones
en WhatsApp, Instagram, Facebook, Telegram, X, Bluesky y Reddit. La conexión con las redes la hace la
API de Zernio.

- **Nuestro repo:** https://github.com/nramosmedmsp/zernflow (remoto `origin`)
- **Repo original:** https://github.com/zernio-dev/zernflow (remoto `upstream`, para traer mejoras)
- **Base de datos:** proyecto **CRM Muscle Shop** en Supabase, organización Muscle Shop Peru
  (ref `irdpastleqrpszzcqgpn`, región Sao Paulo). Es independiente de la base de Nexo.

## Qué ya está hecho (18 oct 2026)

- Repo clonado en `C:\Users\Nicol\Proyectos\crm-muscleshop` con `npm install` ejecutado.
- Proyecto de Supabase creado y las 16 migraciones de `supabase/migrations/` aplicadas (24 tablas).
- `.env` creado con la URL y la anon key de Supabase y un `CRON_SECRET` generado.

## Qué falta para usarlo

1. **Service role key.** En Supabase → proyecto CRM Muscle Shop → *Project Settings → API Keys*, copiar la
   clave `service_role` y pegarla en `.env` en `SUPABASE_SERVICE_ROLE_KEY=`. Sin ella no funcionan los
   webhooks de Zernio, el procesador de secuencias ni la invitación de miembros del equipo.
2. **Cuenta.** Abrir http://localhost:3000/register y crear la primera cuenta. Supabase pide confirmar el
   correo; el enlace llega al correo registrado. Al crearse la cuenta se crea solo un *workspace*.
3. **Clave de Zernio.** Dentro de la app, en *Settings*, pegar la API key de Zernio. Ahí mismo se conectan
   los canales (WhatsApp, Instagram, etc.).
4. **Opcional, IA.** Para el nodo «AI Response» hace falta una clave de Vercel AI Gateway (también en
   *Settings*).

## Cómo arrancar

```bash
cd C:\Users\Nicol\Proyectos\crm-muscleshop
npm run dev
```

Abrir http://localhost:3000.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga automática |
| `npm run build` y `npm start` | Compilar y servir como en producción |
| `npm test` | Pruebas automáticas (vitest) |
| `npm run lint` | Revisión de estilo |

## Para publicarlo

ZernFlow está pensado para Vercel: `vercel.json` ya define los dos crons (`/api/cron/jobs` y
`/api/cron/sequences`, cada minuto). Las variables de `.env` se cargan en Vercel como variables de
entorno; nunca se suben al repositorio (`.env` está en `.gitignore`).

## Traer mejoras del repo original

```bash
git fetch upstream
git merge upstream/main
```
