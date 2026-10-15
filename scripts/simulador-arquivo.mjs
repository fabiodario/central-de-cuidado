import { copyFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * O simulador do Dr. Fabio como arquivo solto (15/10/2026).
 *
 * O build do simulador (vite.simulador.config.ts) ja sai num HTML unico, com
 * o robo, as telas e as imagens dentro. Aqui ele vira um arquivo com nome de
 * gente, na pasta do projeto e na pasta do Dr. Fabio no OneDrive: na reuniao
 * basta dar duplo clique, sem servidor, sem login e sem internet.
 *
 * Gerar de novo depois de qualquer mudanca no robo ou nos textos: o arquivo e
 * uma fotografia do codigo no momento do build.
 */
const pastaDoScript = path.dirname(fileURLToPath(import.meta.url))
const projeto = path.resolve(pastaDoScript, "..")
const origem = path.join(projeto, "dist", "simuladorbot", "index.html")
const NOME = "SIMULADOR - Dr Fabio Dario.html"
const destinos = [path.join(projeto, NOME), path.join(projeto, "..", NOME)]

const tamanho = (await stat(origem)).size
for (const destino of destinos) {
  await copyFile(origem, destino)
  console.log(`Simulador pronto (${Math.round(tamanho / 1024)} KB): ${destino}`)
}
