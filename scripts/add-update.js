/* Trägt eine neue Version in updates.json ein. Aufruf: node scripts/add-update.js <version> <download-url> */
const fs = require("fs");
const [version, link] = process.argv.slice(2);
if (!version || !link) throw new Error("Aufruf: node scripts/add-update.js <version> <download-url>");
const file = "updates.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const id = manifest.browser_specific_settings.gecko.id;
const entry = (data.addons[id] = data.addons[id] || { updates: [] });
entry.updates = entry.updates.filter((update) => update.version !== version);
entry.updates.push({ version, update_link: link });
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`updates.json: ${version} -> ${link}`);
