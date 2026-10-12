// Static server for Firebase App Hosting (Cloud Run): serves the built SPA in dist/ on $PORT.
// Mirrors firebase.json — unknown paths fall back to index.html, hashed assets are cached for a
// year, everything else is revalidated. No dependencies, so it runs on the pruned production image.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT) || 8080;

const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.glb': 'model/gltf-binary',
	'.txt': 'text/plain; charset=utf-8',
	'.webmanifest': 'application/manifest+json'
};

async function file(path) {
	try {
		const s = await stat(path);
		return s.isFile() ? s : null;
	} catch {
		return null;
	}
}

createServer(async (req, res) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405, { Allow: 'GET, HEAD' }).end();
		return;
	}
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
	} catch {
		res.writeHead(400).end();
		return;
	}
	let path = normalize(join(root, pathname));
	if (path !== root && !path.startsWith(root + sep)) {
		res.writeHead(403).end();
		return;
	}
	let info = await file(path);
	if (!info && pathname.endsWith('/')) info = await file((path = join(path, 'index.html')));
	if (!info) info = await file((path = join(root, 'index.html')));
	if (!info) {
		res.writeHead(500).end('dist/ is missing — run npm run build');
		return;
	}
	const immutable = pathname.startsWith('/assets/') && path !== join(root, 'index.html');
	res.writeHead(200, {
		'Content-Type': types[extname(path).toLowerCase()] ?? 'application/octet-stream',
		'Content-Length': info.size,
		'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
		'X-Content-Type-Options': 'nosniff'
	});
	if (req.method === 'HEAD') res.end();
	else createReadStream(path).pipe(res);
}).listen(port, () => console.log(`opencatio3d-cloud listening on :${port}`));
