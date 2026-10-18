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
2. **Migración 00017.** Aplicar `supabase/migrations/00017_workspace_creation_and_invite_only_signup.sql`
   en **cada base** (tienda y gimnasio) antes de desplegar el código nuevo. Sin ella fallan crear espacios
   de trabajo, la página de invitación y el registro solo por invitación (ver más abajo).
3. **Primera cuenta.** Abrir `/register` y crear la primera cuenta. Solo funciona para la primera persona de
   una instalación nueva: se crea su espacio de trabajo y queda como **Dueño**. Supabase puede pedir
   confirmar el correo; el enlace llega al correo registrado.
4. **Clave de Zernio.** Dentro de la app, en *Configuración*, pegar la API key de Zernio. Ahí mismo se
   conectan los canales (WhatsApp, Instagram, etc.).
5. **Opcional, IA.** Para el nodo «AI Response» hace falta una clave de Vercel AI Gateway (también en
   *Configuración*).

## Variables de marca

Cada instalación muestra su propio nombre y logo. Se definen en `.env` (local) y en Vercel:

| Variable | Para qué | Ejemplo |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | Nombre en el login, el menú lateral y la pestaña | `CRM Muscle Shop` / `CRM Gimnasio B2` |
| `NEXT_PUBLIC_APP_LOGO_URL` | Logo y favicon. Ruta de `/public` o URL completa | `/logo.png` o `https://.../logo.png` |
| `NEXT_PUBLIC_APP_DESCRIPTION` | Descripción de la página | `Gestión de conversaciones y clientes` |

Son variables `NEXT_PUBLIC_*`: se fijan al compilar. Después de cambiarlas en Vercel hay que volver a
desplegar. Si faltan, se usa «CRM», `/logo.png` y una descripción genérica.

## Registro solo por invitación

- Nadie puede crear una cuenta por su cuenta, salvo la primera persona de una instalación nueva. El
  trigger `handle_new_user` de la base rechaza cualquier otro registro con `signup_requires_invite`, y la
  pantalla `/register` muestra «El registro es solo por invitación…».
- La raíz del sitio ya no tiene página pública: lleva al panel o al login. `robots.txt` bloquea todo.
- Recomendado: una vez creada la primera cuenta, en Supabase → *Authentication → Sign In / Providers*
  desactivar **Allow new users to sign up**. Las invitaciones siguen funcionando porque la cuenta del
  invitado se crea desde el servidor con la clave de servicio, que no depende de ese interruptor.

## Cómo invitar a alguien (sin correo)

Todavía no hay SMTP propio y el correo de Supabase envía muy pocos mensajes por hora, así que las
invitaciones se comparten copiando un enlace:

1. El **Dueño** entra a *Configuración → Equipo*, escribe el correo de la persona, elige el rol
   (**Miembro** o **Administrador**) y pulsa **Crear invitación**.
2. Aparece el enlace `https://<dominio>/invite/<id>` con el botón **Copiar enlace**. Se envía por
   WhatsApp o por donde convenga. **Vence en 7 días.** En *Invitaciones pendientes* se puede volver a
   copiar o **Revocar** cada invitación.
3. La persona abre el enlace:
   - Si no tiene cuenta, ve **Crea tu cuenta**: su correo aparece fijo y solo pone nombre y contraseña
     (mínimo 8 caracteres). Entra directo al espacio, sin confirmar correo.
   - Si ya tiene cuenta con ese correo, inicia sesión y vuelve sola a la invitación para aceptarla.
   - Si tiene la sesión abierta con otro correo, se le explica y puede cerrar sesión.

El enlace es personal: solo sirve para el correo invitado. Quien lo tenga puede crear la cuenta de ese
correo, así que conviene enviarlo por un canal privado y revocarlo si se envió por error.

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
