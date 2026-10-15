import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, "..")
const distDirectory = path.join(projectDirectory, "dist")
const outputPath = path.join(projectDirectory, "ABRIR SISTEMA.html")

const mimeTypes = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const resolveDistAsset = (reference) =>
  path.join(distDirectory, reference.replace(/^\.\//, ""))

let html = await readFile(path.join(distDirectory, "index.html"), "utf8")

const scriptTag = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/i)
const stylesheetTag = html.match(
  /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i,
)

if (!scriptTag || !stylesheetTag) {
  throw new Error("Não foi possível localizar os arquivos gerados pelo Vite.")
}

let javascript = await readFile(resolveDistAsset(scriptTag[1]), "utf8")
let stylesheet = await readFile(resolveDistAsset(stylesheetTag[1]), "utf8")

const assetsDirectory = path.join(distDirectory, "assets")
const assetNames = await readdir(assetsDirectory)

for (const assetName of assetNames) {
  const mimeType = mimeTypes[path.extname(assetName).toLowerCase()]
  if (!mimeType) continue

  const asset = await readFile(path.join(assetsDirectory, assetName))
  const dataUri = `data:${mimeType};base64,${asset.toString("base64")}`
  const encodedDataUri = JSON.stringify(dataUri)
  const assetPattern = escapeRegExp(assetName)

  javascript = javascript.replace(
    new RegExp(
      `new URL\\(["']${assetPattern}["'],\\s*import\\.meta\\.url\\)\\.href`,
      "g",
    ),
    encodedDataUri,
  )

  for (const reference of [assetName, `./${assetName}`, `./assets/${assetName}`, `/assets/${assetName}`]) {
    stylesheet = stylesheet.replaceAll(`url(${reference})`, `url(${dataUri})`)
    stylesheet = stylesheet.replaceAll(`url("${reference}")`, `url("${dataUri}")`)
    stylesheet = stylesheet.replaceAll(`url('${reference}')`, `url('${dataUri}')`)
  }
}

html = html
  .replace(
    scriptTag[0],
    () =>
      `<script type="module">\n${javascript.replace(/<\/script/gi, "<\\/script")}\n</script>`,
  )
  .replace(
    stylesheetTag[0],
    () => `<style>\n${stylesheet.replace(/<\/style/gi, "<\\/style")}\n</style>`,
  )
  .replace(/\s*<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi, "")
  .replace(
    "<head>",
    "<head>\n    <!-- Arquivo autônomo: pode ser aberto diretamente com duplo clique. -->",
  )

await writeFile(outputPath, html, "utf8")

console.log(`Arquivo pronto para abrir: ${outputPath}`)
