-- Configuración del correo saliente de la app (SMTP propio).
--
-- Una sola fila (id = 1) por instalación. La edita el Dueño o un Administrador
-- desde Configuración → Correo; el servidor valida el rol y escribe con la
-- clave de servicio. RLS activado sin políticas: anon y authenticated no
-- pueden leer ni escribir nada, solo service_role (que ignora RLS).
--
-- password_encrypted guarda la contraseña o token SMTP cifrado con
-- AES-256-GCM (clave derivada por HKDF de SUPABASE_SERVICE_ROLE_KEY, ver
-- lib/mail/crypto.ts). Nunca se guarda en claro.
--
-- Aplicar en cada base (tienda y gimnasio).

create table if not exists public.app_mail_settings (
  id smallint primary key default 1 check (id = 1),
  host text,
  port integer check (port is null or port between 1 and 65535),
  security text check (security is null or security in ('starttls', 'ssl')),
  username text,
  password_encrypted text,
  from_email text,
  from_name text,
  last_error text,
  last_error_at timestamptz,
  last_success_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_mail_settings enable row level security;

revoke all on table public.app_mail_settings from public;
revoke all on table public.app_mail_settings from anon;
revoke all on table public.app_mail_settings from authenticated;
grant select, insert, update, delete on table public.app_mail_settings to service_role;
