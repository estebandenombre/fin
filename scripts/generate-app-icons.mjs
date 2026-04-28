/**
 * Genera icon.png y apple-icon.png cuadrados sin deformar el logo (fit: contain).
 * Origen: raíz del proyecto Gemini_Generated_Image_inq5gwinq5gwinq5.png
 */
import sharp from "sharp";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const source = join(root, "Gemini_Generated_Image_inq5gwinq5gwinq5.png");
const outIcon = join(root, "app", "icon.png");
const outApple = join(root, "app", "apple-icon.png");

/** Misma tonalidad que --background en globals.css */
const bg = { r: 250, g: 250, b: 250, alpha: 1 };

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
