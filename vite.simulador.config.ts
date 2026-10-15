import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Build do simulador do atendimento (simuladorbot/index.html), separado do
 * sistema.
 *
 * Roda depois do build principal, no mesmo dist, e sai em
 * dist/simuladorbot/index.html - no ar, <endereco do sistema>/simuladorbot/.
 * Separado de proposito: o sistema e um arquivo unico (viteSingleFile), e
 * colocar o simulador dentro dele faria toda a recepcao baixar o robo e os
 * roteiros de demonstracao a cada abertura da Agenda.
 *
 * emptyOutDir falso para nao apagar o sistema que o primeiro build acabou de
 * gerar; publicDir falso porque os icones e o manifesto ja foram copiados.
 */
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      input: path.resolve(__dirname, 'simuladorbot/index.html'),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
