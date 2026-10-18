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
   webhooks de Zernio, el procesador de secuencias, la creación de usuarios ni el correo (la contraseña
   SMTP se cifra con una clave derivada de ella).
2. **Migraciones 00017 y 00018.** Aplicar en **cada base** (tienda y gimnasio), en orden, antes de desplegar
   el código nuevo:
   - `00017_workspace_creation_and_invite_only_signup.sql`: creación de espacios y alta solo por invitación.
   - `00018_app_mail_settings.sql`: tabla de la configuración de correo (Configuración → Correo).
3. **URL pública.** `NEXT_PUBLIC_APP_URL` (en `.env` y en Vercel) debe ser la dirección pública de la app,
   sin barra final (p. ej. `https://crm.muscleshop.pe`). Con ella se arman los enlaces de activación.
4. **Ajustes de Supabase Auth** (ver «Configuración de Supabase Auth» más abajo).
5. **Primera cuenta.** Ejecutar `npm run crear-admin -- "Nombre Apellido" correo@dominio` (ver «Primera
   cuenta y Dueño de emergencia»).
6. **Correo.** Dentro de la app, en *Configuración → Correo*, cargar el SMTP (ZeptoMail) y enviar un correo de
   prueba. Mientras tanto se puede trabajar copiando los enlaces de activación.
7. **Clave de Zernio.** Dentro de la app, en *Configuración*, pegar la API key de Zernio. Ahí mismo se
   conectan los canales (WhatsApp, Instagram, etc.).
8. **Opcional, IA.** Para el nodo «AI Response» hace falta una clave de Vercel AI Gateway (también en
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

## Acceso solo por invitación

- Nadie puede crear una cuenta por su cuenta: no hay página de registro. Los usuarios los crea el
  **Dueño** o un **Administrador** desde *Configuración → Equipo*; la primera cuenta de una instalación se
  crea con el script `crear-admin`.
- El trigger `handle_new_user` de la base (00017) rechaza cualquier alta que no tenga una invitación
  pendiente para ese correo, salvo la primera persona de una instalación vacía.
- La raíz del sitio no tiene página pública: lleva al panel o al login. `robots.txt` bloquea todo.
- Los enlaces antiguos `/invite/<id>` ya no crean cuentas: dicen que las invitaciones llegan por correo
  y llevan al login.

## Cómo crear usuarios

1. El **Dueño** o un **Administrador** entra a *Configuración → Equipo → Crear usuario*, escribe nombre,
   correo y rol (**Miembro** o **Administrador**) y pulsa **Crear usuario**.
2. La app crea la cuenta (con `auth.admin.generateLink`, sin correos de Supabase), la agrega al espacio
   con ese rol y arma un enlace propio
   `https://<dominio>/auth/confirm?token_hash=…&type=invite&next=/cuenta/contrasena`.
   - **Con correo configurado:** se lo envía a la persona.
   - **Sin correo configurado:** muestra «El correo aún no está configurado…» y el botón **Copiar enlace de
     activación**. Compártelo solo por un canal privado: quien lo abra podrá activar la cuenta. Cada clic
     genera un enlace nuevo e invalida el anterior.
   - **Si el correo ya tenía cuenta:** solo le da acceso al espacio («Esta persona ya tenía cuenta; ya tiene
     acceso») y no envía nada.
3. La persona abre el enlace: `/auth/confirm` muestra un botón **Continuar** y no valida nada al abrirse
   (así las vistas previas de WhatsApp y los filtros de correo no gastan el enlace de un solo uso). Al
   pulsarlo se valida el token y se abre sesión, y en `/cuenta/contrasena` crea su contraseña (mínimo 8
   caracteres). Luego entra al panel.

En la lista de miembros cada persona aparece como **Activo** o **Pendiente de activar** (nunca inició
sesión). Para los pendientes hay **Reenviar invitación** y **Copiar enlace de activación**. Para los
activos, **Enviar enlace para restablecer contraseña** (o copiarlo si no hay correo). El Dueño y los
Administradores pueden quitar miembros; nadie puede quitar al Dueño ni quitarse a sí mismo, y nunca se
puede copiar un enlace de acceso del Dueño (solo enviárselo por correo).

**¿Olvidaste tu contraseña?** en el login envía el enlace si hay correo configurado; si no, dice «Por ahora
pide a un administrador que te restablezca la contraseña.». En ningún caso revela si el correo existe.
Cualquiera con sesión puede cambiar su contraseña desde **Cambiar contraseña** en el menú lateral.

Los enlaces vencen según *Email OTP Expiration* de Supabase (ver abajo) y solo funcionan una vez. Si
venció, al pulsar **Continuar** se lleva al login con «El enlace venció o ya se usó. Pide uno nuevo.».

## Correo saliente (Configuración → Correo)

La app envía sus propios correos (invitaciones, restablecer contraseña y prueba) con un SMTP que se
configura dentro de la app. **No se usa el SMTP ni las plantillas de correo de Supabase.**

- Solo el **Dueño** y los **Administradores** ven *Configuración → Correo*. La configuración es de toda la
  instalación (una fila en la tabla `app_mail_settings`, sin acceso para `anon` ni `authenticated`).
- Campos: servidor, puerto, seguridad (STARTTLS 587 o SSL 465), usuario, contraseña o token, correo
  remitente y nombre del remitente. La contraseña se guarda cifrada (AES-256-GCM, clave derivada de
  `SUPABASE_SERVICE_ROLE_KEY`) y nunca se vuelve a mostrar; dejarla vacía al guardar conserva la actual.
  Si se rota la service role key, hay que volver a escribirla.
- **Enviar correo de prueba** lo manda al correo de quien lo pide. El estado muestra «Sin configurar»,
  «Configurado» o el último error.
- Con **ZeptoMail**: servidor `smtp.zeptomail.com`, puerto `587` (STARTTLS), usuario `emailapikey`,
  contraseña = token SMTP del Mail Agent, remitente de un dominio verificado en ZeptoMail.
- Respaldo opcional: si la tabla está vacía y existen las variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS` y `MAIL_FROM` (p. ej. `CRM Muscle Shop <no-responder@muscleshop.pe>`), se usan esas.

## Configuración de Supabase Auth

En Supabase → *Authentication*:

- **URL Configuration:** *Site URL* = la URL pública de la app. En *Redirect URLs* agregar
  `https://<dominio>/auth/confirm` (y `http://localhost:3000/auth/confirm` para desarrollo).
- **Sign In / Providers → Allow new users to sign up:** desactivarlo. La creación de usuarios desde
  *Equipo* y el script siguen funcionando porque usan la clave de servicio.
- **Sign In / Providers → Email → Email OTP Expiration:** poner `86400` (24 horas) para que los enlaces de
  activación duren lo que dice la app. Con el valor por defecto (3600) vencen en 1 hora.
- No hace falta tocar *SMTP Settings* ni *Email Templates*: la app no usa los correos de Supabase.

## Primera cuenta y Dueño de emergencia

```bash
npm run crear-admin -- "Nombre Apellido" correo@dominio
# o: node scripts/crear-admin.mjs "Nombre Apellido" correo@dominio [id-o-slug-del-espacio]
```

Lee `.env` (necesita `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_APP_URL`) e
imprime cada paso:

- **Instalación nueva (sin espacios):** crea la cuenta y el trigger crea su espacio con la persona como Dueño.
- **Ya hay espacios:** usa el indicado, el único o el primero sin un Dueño útil (que haya iniciado sesión
  alguna vez), crea la invitación pendiente que exige el trigger, crea la cuenta y la agrega como Dueño.
  Si la cuenta ya existía, solo la agrega como Dueño. Si todos los espacios tienen un Dueño activo, no
  hace nada y pide usar *Configuración → Equipo*.
- Envía el enlace de activación con el correo de la app; si no hay correo, **imprime el enlace** para
  compartirlo por un canal privado.

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
| `npm run crear-admin -- "Nombre" correo` | Crea la primera cuenta (Dueño) |

## Para publicarlo

ZernFlow está pensado para Vercel: `vercel.json` ya define los dos crons (`/api/cron/jobs` y
`/api/cron/sequences`, cada minuto). Las variables de `.env` se cargan en Vercel como variables de
entorno; nunca se suben al repositorio (`.env` está en `.gitignore`).

## Traer mejoras del repo original

```bash
git fetch upstream
git merge upstream/main
```
