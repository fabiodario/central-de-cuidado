-- Corrente de integridade do prontuario.
--
-- A tabela de auditoria ja era append-only: gatilhos recusam update, delete e
-- truncate. Isso impede que alguem edite o historico pela aplicacao, mas nao
-- prova nada para um terceiro - quem tem acesso direto ao banco poderia
-- desativar o gatilho, apagar uma linha e religar, e ninguem saberia dizer que
-- faltou alguma coisa.
--
-- O encadeamento resolve isso. Cada registro guarda a impressao digital do
-- registro anterior, e a sua propria impressao digital inclui a do anterior.
-- Mexer num elo muda o hash dele, que deixa de bater com o que o elo seguinte
-- guardou, e a quebra aparece exatamente no ponto em que aconteceu.
--
-- O que isto E: prova de INTEGRIDADE e de ORDEM. Se a corrente fecha, o
-- historico nao foi tocado desde que foi escrito.
--
-- O que isto NAO E: prova de AUTORIA nem de DATA perante terceiros. Quem
-- assina e o certificado ICP-Brasil do medico; quem prova a data e o carimbo
-- do tempo de uma autoridade credenciada. Sao as duas camadas seguintes, e
-- esta aqui e a fundacao de ambas - sem historico integro, assinar nao
-- adianta.

begin;

alter table private.consultation_audit
  add column if not exists previous_hash text,
  add column if not exists record_hash text;

comment on column private.consultation_audit.previous_hash is
  'Impressao digital do registro anterior desta clinica. Nulo apenas no primeiro elo.';
comment on column private.consultation_audit.record_hash is
  'SHA-256 deste registro, incluindo o hash do anterior. E o que amarra a corrente.';

/**
 * Calcula o elo antes de gravar.
 *
 * O lock por clinica existe porque dois atendimentos salvos no mesmo instante
 * poderiam ler o mesmo "anterior" e criar dois elos irmaos - uma bifurcacao
 * que a conferencia acusaria como quebra sem que ninguem tivesse feito nada
 * errado. Numa clinica de um medico isso e raro; e barato o bastante para nao
 * depender de sorte.
 */
create or replace function private.encadear_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  anterior text;
begin
  perform pg_advisory_xact_lock(hashtext(new.clinic_id::text));

  select a.record_hash
  into anterior
  from private.consultation_audit a
  where a.clinic_id = new.clinic_id
  order by a.id desc
  limit 1;

  new.previous_hash := anterior;
  -- O separador entre campos evita que a concatenacao de dois valores
  -- diferentes produza a mesma string - "ab"+"c" e "a"+"bc" precisam gerar
  -- hashes distintos.
  new.record_hash := encode(
    sha256(
      convert_to(
        coalesce(anterior, '') || '|' ||
        new.consultation_id::text || '|' ||
        new.clinic_id::text || '|' ||
        new.patient_id::text || '|' ||
        to_char(new.changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
        coalesce(new.changed_by::text, '') || '|' ||
        new.before_data::text || '|' ||
        new.after_data::text,
        'UTF8'
      )
    ),
    'hex'
  );

  return new;
end
$function$;

drop trigger if exists consultation_audit_encadear on private.consultation_audit;
create trigger consultation_audit_encadear
before insert on private.consultation_audit
for each row execute function private.encadear_auditoria();

/**
 * Confere a corrente inteira e diz onde ela quebra, se quebrar.
 *
 * Recalcula cada elo a partir do conteudo gravado e compara com o hash
 * guardado. Devolve o total de registros, o hash da ponta (que serve de
 * "selo" do acervo naquele instante) e o id do primeiro elo com problema.
 *
 * security definer porque a tabela vive no schema private e ninguem tem
 * acesso direto a ela - a checagem de clinica esta logo abaixo.
 */
create or replace function public.conferir_integridade_prontuario(p_clinic_id uuid)
returns table (
  total bigint,
  registros_encadeados bigint,
  selo text,
  quebrado_no_id bigint,
  quebrado_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  linha record;
  esperado text;
  anterior text := null;
  contados bigint := 0;
  encadeados bigint := 0;
  falha_id bigint := null;
  falha_em timestamptz := null;
  ultimo text := null;
begin
  if not private.is_clinic_member(p_clinic_id) then
    raise exception 'sem acesso a esta clinica' using errcode = '42501';
  end if;

  for linha in
    select * from private.consultation_audit
    where clinic_id = p_clinic_id
    order by id
  loop
    contados := contados + 1;

    -- Registro antigo, gravado antes de a corrente existir: conta no total mas
    -- nao entra na conferencia. Mentir sobre isso seria pior do que admitir.
    if linha.record_hash is null then
      continue;
    end if;

    esperado := encode(
      sha256(
        convert_to(
          coalesce(anterior, '') || '|' ||
          linha.consultation_id::text || '|' ||
          linha.clinic_id::text || '|' ||
          linha.patient_id::text || '|' ||
          to_char(linha.changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
          coalesce(linha.changed_by::text, '') || '|' ||
          linha.before_data::text || '|' ||
          linha.after_data::text,
          'UTF8'
        )
      ),
      'hex'
    );

    if falha_id is null and (esperado is distinct from linha.record_hash) then
      falha_id := linha.id;
      falha_em := linha.changed_at;
    end if;

    encadeados := encadeados + 1;
    anterior := linha.record_hash;
    ultimo := linha.record_hash;
  end loop;

  return query select contados, encadeados, ultimo, falha_id, falha_em;
end
$function$;

revoke all on function public.conferir_integridade_prontuario(uuid)
  from public, anon, authenticated;
grant execute on function public.conferir_integridade_prontuario(uuid) to authenticated;

revoke all on function private.encadear_auditoria() from public, anon, authenticated;

comment on function public.conferir_integridade_prontuario(uuid) is
  'Recalcula a corrente de auditoria da clinica e aponta o primeiro elo adulterado, se houver.';

commit;
