begin;

/**
 * Ver o que o paciente mandou.
 *
 * Hoje foto, exame, áudio e documento viram a palavra "[image]" na tela. A
 * clínica sabe que chegou alguma coisa e não consegue olhar. O robô já faz a
 * parte certa - reconhece que é anexo e chama a equipe em vez de responder
 * menu -, mas a equipe chega e não tem o que ver.
 *
 * COMO A META ENTREGA: o webhook não traz o arquivo, traz um id. Para pegar os
 * bytes é preciso resgatar a URL com esse id e baixar, tudo autenticado com o
 * token, e a URL vive poucos minutos. Ou seja: ou o webhook baixa na hora, ou
 * o arquivo se perde. Guardar só o id não resolve - depois já não abre.
 *
 * Por isso o arquivo é copiado para um acervo nosso no momento em que chega.
 *
 * PRIVADO, e por um motivo concreto: o que vem aqui é foto de exame, de lesão,
 * de criança. É dado de saúde, com nome e telefone ao lado na mesma tela. Link
 * público seria vazamento de prontuário esperando acontecer - a mesma razão
 * que levou o acervo dos PDFs assinados a ser privado em 05/09/2026. Quem
 * precisa ver recebe um link temporário, gerado na hora.
 */

alter table public.whatsapp_messages
  add column if not exists media_path text,
  add column if not exists media_mime text;

comment on column public.whatsapp_messages.media_path is
  'Caminho do anexo no acervo privado. Nulo quando a mensagem nao tem arquivo.';
comment on column public.whatsapp_messages.media_mime is
  'Tipo do arquivo, como a Meta informou. Decide se a tela mostra imagem, audio ou link.';

/**
 * Acervo dos anexos recebidos.
 *
 * O limite de 20 MB acompanha o da própria Meta para mídia recebida, e os
 * tipos são os que o WhatsApp de fato entrega. Fechar a lista importa: sem
 * ela, um arquivo com tipo inesperado entraria no acervo da clínica.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-anexos',
  'whatsapp-anexos',
  false,
  20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr',
    'video/mp4', 'video/3gpp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- Caminho do arquivo: <clinic_id>/<message_id>
--
-- A pasta é o id da clínica, como no acervo dos assinados: a permissão de
-- leitura vira uma pergunta simples - "você é membro desta clínica?" -
-- respondida pelo mesmo helper que o resto do sistema usa.
drop policy if exists "membros leem os anexos da propria clinica" on storage.objects;
create policy "membros leem os anexos da propria clinica"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'whatsapp-anexos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and private.is_clinic_member(((storage.foldername(name))[1])::uuid)
  );

-- Escrita não tem policy: quem grava aqui é o webhook, com service_role. O
-- navegador poder subir arquivo neste acervo seria deixar qualquer um plantar
-- uma foto como se o paciente tivesse enviado.

commit;
