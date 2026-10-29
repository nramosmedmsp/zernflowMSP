-- Tanda 4: difusiones sin duplicados (A-9) y motivos de fallo en español (B-21).
--
-- 1. Un contacto solo puede ser destinatario una vez por difusión. Si algún
--    envío anterior ya dejó destinatarios repetidos, se conserva uno por
--    contacto (el que ya salió, si lo hay) y se borran los demás antes de crear
--    la restricción. Los contadores de la difusión (sent_count / failed_count)
--    no se recalculan.
-- 2. Los motivos de fallo que el cron guardó en inglés pasan a español.

delete from broadcast_recipients br
using (
  select id,
         row_number() over (
           partition by broadcast_id, contact_id
           order by case status when 'sent' then 0 when 'sending' then 1 when 'failed' then 2 else 3 end,
                    sent_at nulls last,
                    id
         ) as rn
  from broadcast_recipients
) ranked
where br.id = ranked.id and ranked.rn > 1;

create unique index if not exists uq_broadcast_recipients_contact
  on broadcast_recipients (broadcast_id, contact_id);

update broadcast_recipients
set error_message = 'El envío se interrumpió y no se sabe si el mensaje llegó. Revisa el chat del contacto antes de volver a enviarlo.'
where error_message = 'Interrupted mid-send; delivery outcome unknown';
