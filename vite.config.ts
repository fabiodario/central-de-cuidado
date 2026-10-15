import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Identificacao da versao publicada.
 *
 * Sem isto, "publiquei" e "esta no ar" eram duas coisas diferentes e ninguem
 * sabia qual estava vendo: o GitHub leva minutos para servir o build novo, e o
 * navegador guarda o antigo em cache. Aparece no rodape do menu lateral.
 *
 * A hora e a do momento em que o build roda. O commit vem do GitHub Actions
 * quando publica de verdade; rodando na maquina fica "local", que ja diz o que
 * precisa dizer.
 */
const VERSAO = new Date().toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const COMMIT = (process.env.GITHUB_SHA ?? 'local').slice(0, 7)

// https://vite.dev/config/
export default defineConfig({
  define: {
    __VERSAO__: JSON.stringify(VERSAO),
    __COMMIT__: JSON.stringify(COMMIT),
  },
  base: './',
  plugins: [inspectAttr(), react(), viteSingleFile()],
  build: {
    assetsInlineLimit: 100000000,
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
