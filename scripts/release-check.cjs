const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const m = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
const versions = JSON.parse(read("versions.json"));
for (const field of ["id", "name", "version", "minAppVersion", "description", "author"]) {
  assert.equal(typeof m[field], "string", `Missing ${field}`);
  assert.ok(m[field].trim(), `Empty ${field}`);
}
assert.match(m.id, /^[a-z]+(?:-[a-z]+)*$/);
assert.ok(!m.id.includes("obsidian") && !m.id.endsWith("plugin"));
assert.match(m.name, /^[A-Za-z0-9 +()-]+$/);
assert.ok(!/obsidian|obsi-|-sidian|plugin/i.test(m.name));
assert.match(m.version, /^\d+\.\d+\.\d+$/);
assert.match(m.minAppVersion, /^\d+\.\d+\.\d+$/);
assert.equal(typeof m.isDesktopOnly, "boolean");
assert.ok(m.description.length <= 250 && m.description.endsWith("."));
assert.equal(pkg.version, m.version);
assert.equal(pkg.name, m.id);
assert.equal(versions[m.version], m.minAppVersion);
for (const file of ["README.md", "LICENSE", "main.js"]) assert.ok(read(file).trim());
assert.ok(!/REPLACE_WITH_AUTHOR/.test(m.author + read("LICENSE")), "Replace the author placeholder in manifest.json and LICENSE before publishing.");
console.log("Release metadata passed. Confirm name/ID uniqueness and finish the manual runtime checklist before submission.");
