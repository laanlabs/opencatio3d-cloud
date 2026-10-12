// Copies the published catalog from the website repo into the planner:
//   ../opencatio3d-www/catalog/data/*.json  →  src/lib/catalog/*.json
// (or from a path given as the first argument). Checks the files parse, share one catalogVersion
// and have unique ids before replacing anything, so a broken catalog never reaches a build.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(process.argv[2] ?? join(here, '../../opencatio3d-www/catalog/data'));
const to = join(here, '../src/lib/catalog');
const FILES = { materials: 'materials', components: 'components', templates: 'templates', plants: 'plants', rules: 'rules', sources: 'sources' };

const docs = {};
for (const [name, key] of Object.entries(FILES)) {
	const path = join(from, `${name}.json`);
	if (!existsSync(path)) { console.error(`missing ${path}`); process.exit(1); }
	const doc = JSON.parse(readFileSync(path, 'utf8'));
	if (!Array.isArray(doc[key])) { console.error(`${name}.json has no "${key}" array`); process.exit(1); }
	const ids = new Set();
	for (const x of doc[key]) {
		if (!x.id || ids.has(x.id)) { console.error(`${name}.json: missing or duplicate id ${x.id}`); process.exit(1); }
		ids.add(x.id);
	}
	docs[name] = doc;
}
const versions = new Set(Object.values(docs).map((d) => d.catalogVersion));
if (versions.size !== 1) { console.error(`catalog files disagree on catalogVersion: ${[...versions].join(', ')}`); process.exit(1); }
for (const name of Object.keys(FILES)) copyFileSync(join(from, `${name}.json`), join(to, `${name}.json`));
console.log(`catalog ${[...versions][0]}: ${Object.entries(FILES).map(([n, k]) => `${docs[n][k].length} ${n}`).join(', ')} → src/lib/catalog/`);
