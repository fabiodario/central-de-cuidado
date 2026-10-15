begin;

/**
 * O segundo telefone da clínica.
 *
 * Ontem os dois números cabiam num campo só, separados por barra. Funcionava e
 * lia mal: quem preenche não adivinha o separador, e quem lê depois não sabe
 * qual é o fixo e qual é o WhatsApp. Dois campos dizem isso sozinhos.
 *
 * Os dois saem impressos na receita; o cadastro do médico na Memed leva o
 * primeiro, porque lá só cabe um.
 */
alter table public.clinic_settings
  add column if not exists clinic_phone_alt text not null default '';

comment on column public.clinic_settings.clinic_phone_alt is
  'Segundo telefone de contato da clinica (WhatsApp, em geral). Sai na receita junto do primeiro.';

grant update (clinic_phone_alt) on table public.clinic_settings to authenticated;

-- Quem ja tinha os dois numeros num campo so, separados por barra, fica com um
-- em cada campo. Sem barra, nada muda.
update public.clinic_settings
set clinic_phone = btrim(split_part(clinic_phone, '/', 1)),
    clinic_phone_alt = btrim(split_part(clinic_phone, '/', 2))
where clinic_phone like '%/%'
  and clinic_phone_alt = '';

commit;
