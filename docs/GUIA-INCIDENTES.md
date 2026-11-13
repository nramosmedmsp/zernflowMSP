# Qué hacer cuando algo falla (guía de una página)

Para el Dueño y una segunda persona de confianza. Sin jerga: sigue los pasos en orden y anota lo que hagas (sección 6).
**Regla de oro: no borres nada ni cambies configuraciones "a ver si funciona". Primero mira, después actúa.**

## 1. Cómo saber que algo anda mal

- **Aviso del monitor externo** (si está configurado): la dirección `https://crm.muscleshopperu.com/api/health` debe revisarse cada 1 a 5 minutos y avisar tras 2 fallos seguidos.
  - Todo bien: la página muestra `{"ok":true}`.
  - Problema: responde error 503 con una razón: `base` (la app no llega a la base de datos), `cron_jobs` o `cron_secuencias` (una tarea automática lleva más de 5 minutos sin terminar bien).
- **Tarjeta «Estado del sistema»** en Configuración (solo Dueño y Administrador): muestra la última vez que cada tarea automática corrió bien (en rojo si falló) y los mensajes de clientes que no se pudieron procesar.
- **Notificación dentro de la app**: si un mensaje de un cliente falla 3 veces, el Dueño y los Administradores reciben el aviso «Un mensaje de un cliente no se pudo procesar».
- **El equipo avisa**: «no me llegan mensajes», «no abre», etc.

## 2. Síntoma → qué revisar primero → qué hacer

| Síntoma | Revisa primero | Qué hacer |
|---|---|---|
| **La app no abre** | Abre `/api/health` en otra pestaña y mira las páginas de estado de Vercel y Supabase (sección 3). Prueba desde otro aparato o con datos del celular. | Si un proveedor tiene problemas, espera y avisa al equipo. Si todo parece normal y empezó justo después de un cambio, vuelve a la versión anterior (sección 4). Si sigue, llama a soporte técnico. |
| **Abre, pero sale «Algo salió mal»** | Recarga la página. Anota qué estabas haciendo. Lo ya guardado no se pierde. | Si pasa en todas las pantallas o a todos, mira `/api/health` y la sección 3. Si empezó tras una actualización, vuelve a la versión anterior (sección 4). |
| **No llegan mensajes de clientes** | Configuración → «Estado del sistema»: ¿hay mensajes sin procesar? Mira el estado de Zernio y Meta. Revisa que el canal siga conectado en Zernio. | Mensajes "reintentándose solos": espera unos minutos. Mensajes fallidos: revisa esas conversaciones en la Bandeja y asigna la gestión a mano. Si hay mensajes fallidos, pide a soporte técnico reprocesarlos (se pueden recuperar durante 7 días). |
| **Los mensajes no salen** | ¿Falla con un solo cliente o con todos? En WhatsApp, ¿pasaron más de 24 h desde que el cliente escribió (solo se puede contestar con plantilla)? Mira Zernio y Meta. | Si es un solo cliente, probablemente es la ventana de 24 h o el canal. Si es con todos, revisa la conexión del canal en Zernio y llama a soporte técnico. |
| **El bot o las tareas automáticas no corren** (tarjeta en rojo, `/api/health` responde `cron_jobs` o `cron_secuencias`) | Tarjeta «Estado del sistema»: ¿qué tarea está en rojo y desde cuándo? Las tareas corren cada minuto en Vercel y requieren plan de pago: confirma que la cuenta de Vercel esté al día. | Espera 5 minutos y recarga. Si sigue en rojo, mira Vercel y Supabase (sección 3) y llama a soporte técnico con el texto de la tarjeta. |
| **Alguien no puede entrar** | ¿Escribe bien el correo? ¿Le aparece «¿Olvidaste tu contraseña?» en el inicio de sesión? ¿Sigue en el equipo (Configuración → Equipo)? | Que use «¿Olvidaste tu contraseña?» y revise spam. Si no llega el correo o la invitación venció, vuelve a invitarla desde Configuración → Equipo. Si no entra nadie, ver «La app no abre». |
| **Se sospecha una cuenta robada** | ¿Hay actividad rara, mensajes que esa persona no envió, o perdió el celular/correo? | **Rápido:** 1) esa persona cambia su contraseña (Configuración → Cambiar contraseña, o «¿Olvidaste tu contraseña?»). 2) Si no puede, quítala del equipo en Configuración → Equipo hasta aclararlo. 3) Revisa Configuración → Equipo por personas o roles que no reconozcas. 4) Revisa «Registro de «Ver como»» en Configuración. 5) Avisa a soporte técnico. |
| **«Ver como» dejó a todos sin poder trabajar** (solo técnico) | Primero pulsa «Volver a mi vista». Si todos siguen bloqueados, es un problema de la base. | Una persona técnica ejecuta estas dos sentencias en Supabase (editor SQL): `alter role authenticator reset pgrst.db_pre_request;` y `notify pgrst, 'reload config';`. Apaga «Ver como» sin borrar nada. |

## 3. Páginas de estado de los proveedores

Búscalas por nombre en Google («status» + nombre) y guarda aquí los enlaces que confirmes: Vercel (donde vive la app), Supabase (la base de datos, región São Paulo), Zernio (conexión con WhatsApp, Instagram y Facebook) y Meta (WhatsApp, Instagram, Facebook).

- Vercel status: ________________
- Supabase status: ________________
- Zernio status: ________________
- Meta status: ________________

Si el problema está en un proveedor, no hay nada que arreglar de nuestro lado: espera y avisa al equipo.

## 4. Volver a la versión anterior de la app

Úsalo si la app falló justo después de una actualización.

1. Entra a Vercel, proyecto `crm-muscleshop`, sección **Deployments**.
2. Elige el despliegue anterior que sí funcionaba.
3. Pulsa **Instant Rollback** (o **Promote to Production**).
4. Abre la app y `/api/health` para comprobar.

Esto **no deshace cambios en la base de datos**. Las copias de seguridad las hace Supabase; restaurar es una tarea técnica y se pide a soporte técnico.

## 5. A quién llamar

| Para qué | Nombre | Teléfono |
|---|---|---|
| Soporte técnico | | |
| Segunda persona de confianza | | |
| Cuenta de Vercel (quién tiene acceso) | | |
| Cuenta de Supabase (quién tiene acceso) | | |
| Cuenta de Zernio (quién tiene acceso) | | |

## 6. Qué anotar durante un incidente

- **Hora** en que empezó y en que se resolvió.
- **Qué se vio**: mensaje de error, pantalla, texto de la tarjeta «Estado del sistema», razón de `/api/health`. Una captura ayuda.
- **A quién afecta**: a todos, a una persona, a un canal.
- **Qué se hizo** y a qué hora, y quién lo hizo.
- **Cómo terminó** y qué cambiar para que no se repita.
