// Copia o descompactador RAR (WebAssembly) para public/, de onde o navegador o carrega.
import fs from "node:fs";
const origem = "node_modules/node-unrar-js/esm/js/unrar.wasm";
if (fs.existsSync(origem)) {
  fs.mkdirSync("public", { recursive: true });
  fs.copyFileSync(origem, "public/unrar.wasm");
}
