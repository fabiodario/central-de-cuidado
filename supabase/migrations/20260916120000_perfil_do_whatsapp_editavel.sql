begin;

/**
 * O perfil do WhatsApp vira dado, e não texto fixo no código.
 *
 * É o cartão de visita que a família vê ao tocar no nome da conversa: site,
 * endereço, descrição e e-mail. Nasceu ontem como constante dentro da função
 * que grava na Meta, o que é aceitável para o site (que não muda) e ruim para
 * o endereço: sala, prédio e até a unidade mudam com frequência, e cada troca
 * exigiria um programador e uma publicação.
 *
 * Agora mora aqui, ao lado do telefone e do CRM, e é editado em Preferências.
 * Quem escreve é a clínica; o sistema só entrega à Meta.
 */

alter table public.clinic_settings
  add column if not exists whatsapp_profile_about text not null default '',
  add column if not exists whatsapp_profile_address text not null default '',
  add column if not exists whatsapp_profile_description text not null default '',
  add column if not exists whatsapp_profile_email text not null default '',
  add column if not exists whatsapp_profile_website text not null default '';

comment on column public.clinic_settings.whatsapp_profile_about is
  'Recado curto do perfil do WhatsApp (limite de 139 caracteres na Meta).';
comment on column public.clinic_settings.whatsapp_profile_address is
  'Endereco mostrado no perfil do WhatsApp. Um so: a Meta nao aceita dois.';
comment on column public.clinic_settings.whatsapp_profile_description is
  'Descricao do consultorio no perfil do WhatsApp (limite de 512 caracteres).';
comment on column public.clinic_settings.whatsapp_profile_email is
  'E-mail de contato mostrado no perfil do WhatsApp.';
comment on column public.clinic_settings.whatsapp_profile_website is
  'Site mostrado no perfil do WhatsApp.';

grant update (
  whatsapp_profile_about,
  whatsapp_profile_address,
  whatsapp_profile_description,
  whatsapp_profile_email,
  whatsapp_profile_website
) on table public.clinic_settings to authenticated;

-- No sistema do Dr. Marcello aqui vinha o perfil que ja estava gravado na Meta
-- em 16/09/2026 (recado, endereco, descricao, e-mail e site DELE), copiado
-- para toda clinica com o site vazio, para a tela abrir mostrando a verdade.
--
-- No banco do Dr. Fabio (15/10/2026) esse update saiu; as cinco colunas acima
-- ficam. O filtro nao olhava a clinica: a do Dr. Fabio, se ja existisse
-- quando isto rodasse, ganharia o e-mail e o site do Dr. Marcello, e o botao
-- de Preferencias os mandaria para a Meta no perfil do numero dele. O perfil
-- do Dr. Fabio comeca vazio e e preenchido em Preferencias (o e-mail ainda
-- nao foi definido; o site e drfabiopavanidario.com.br). Esta migration ainda
-- nao tinha sido aplicada no banco do Dr. Fabio, entao foi ajustada aqui
-- mesmo; o original esta no repositorio do Dr. Marcello.

commit;
