/**
 * Genera icon.png y apple-icon.png a partir del logo fuente (cuadrado, sin deformar).
 * Origen: app-logo-source.png en la raíz del proyecto.
 */
import sharp from "sharp";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const source = join(root, "app-logo-source.png");
const outIcon = join(root, "app", "icon.png");
const outApple = join(root, "app", "apple-icon.png");

/** Fondo negro alineado con el logo (círculo blanco sobre negro); solo aplica si hace falta letterbox */
const bg = { r: 0, g: 0, b: 0, alpha: 1 };

async function main() {
  await sharp(source)
    .resize(512, 512, { fit: "contain", background: bg })
    .png({ compressionLevel: 9 })
    .toFile(outIcon);

  await sharp(source)
    .resize(180, 180, { fit: "contain", background: bg })
    .png({ compressionLevel: 9 })
    .toFile(outApple);

  console.log("OK:", outIcon, outApple);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
