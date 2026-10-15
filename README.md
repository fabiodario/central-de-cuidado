# Central de Cuidado - Dr. Fábio Dario

Sistema de agenda, prontuário e atendimento pelo WhatsApp do consultório do
Dr. Fábio Dario, otorrinolaringologista (Santos e São Paulo). Espelho do
sistema da Central de Cuidado usado em produção pelo Dr. Marcello Ruiz,
adaptado em 15/10/2026.

## Estado atual

- Robô do WhatsApp adaptado ao consultório: adultos e crianças, motivo da
  consulta na ficha, convênios de Santos (Porto Saúde, Unimed Santos, Santa
  Saúde), alerta de sangramento no celular do Dr. Fábio e da Dayane.
- Simulador do atendimento pronto para reunião:
  `SIMULADOR - Dr Fabio Dario.html` (duplo clique, sem internet).
- Ainda sem banco (Supabase), sem número de WhatsApp (Meta) e sem publicação.
  Ver `../LEIA-ME - Projeto Dr Fabio Dario.md`.

## Atalhos

| Arquivo | O que faz |
| --- | --- |
| `GERAR SIMULADOR.bat` | Testa o robô e gera o simulador em arquivo único |
| `SIMULAR CONVERSAS.bat` | Imprime todas as conversas de demonstração para leitura |
| `TESTAR BOT.bat` | Roda a bateria de testes do robô |
| `PUBLICAR.bat` | Travado até existir o repositório do Dr. Fábio |

## Desenvolvimento

```bash
npm run dev
```

O simulador fica em `http://localhost:3000/simuladorbot/`. O sistema completo
precisa de um `.env.local` com o Supabase do Dr. Fábio (modelo em
`.env.example`); nunca use a URL ou a chave do Dr. Marcello.

```bash
npm run test:bot
```

```bash
npm run build
```
