/**
 * Publica uma release no GitHub com os executáveis gerados por `npm run dist`.
 *
 * Uso (PowerShell):
 *   $env:GH_TOKEN = "<token com permissão 'contents: write' no seu repositório de releases>"
 *   $env:GH_REPO = "seu-usuario/resenha-releases"
 *   npm run release
 *
 * A versão vem do package.json; as notas, de RELEASE_NOTES.md (se existir).
 * NUNCA coloque tokens neste arquivo: ele fica público no repositório.
 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
// Publica no repositório público de releases: o app (electron-updater) lê de lá sem precisar de login
function releasesRepo() {
  if (process.env.GH_REPO) return process.env.GH_REPO;
  const publish = (require(path.join(__dirname, '..', 'package.json')).build?.publish || [])[0] || {};
  if (publish.owner && publish.repo && publish.owner !== 'SEU-USUARIO-DO-GITHUB') return `${publish.owner}/${publish.repo}`;
  console.error('Defina GH_REPO (ex.: seu-usuario/resenha-releases) ou build.publish no package.json.');
  process.exit(1);
}
const REPO = releasesRepo();
const ROOT = path.join(__dirname, '..');
const { version } = require(path.join(ROOT, 'package.json'));
const TAG = `v${version}`;
const TITLE = `Resenha Client v${version}`;
const notesFile = path.join(ROOT, 'RELEASE_NOTES.md');
const NOTES = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : `Resenha ${TAG}`;
const PRERELEASE = process.argv.includes('--prerelease');

// latest.yml e o .blockmap são lidos pelo atualizador automático do app (electron-updater)
const FILES = [
  `Resenha-Setup-${version}.exe`,
  `Resenha-Setup-${version}.exe.blockmap`,
  'latest.yml',
  `Resenha-Portable-${version}.exe`
].map((name) => ({
  name,
  path: path.join(ROOT, 'dist-electron', name)
}));

// Pacote da versão web (gerado pelo CI): o servidor do Resenha baixa daqui e serve no navegador
const WEB_BUNDLE = { name: `resenha-web-${version}.zip`, path: path.join(ROOT, 'dist-electron', `resenha-web-${version}.zip`) };

const headers = (extra = {}) => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Resenha-Release',
  ...extra
});

async function api(url, options = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(url, { ...options, headers: headers(options.headers) });
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`Falha de rede (${err.message}); tentando de novo...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function getOrCreateRelease() {
  const res = await api(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: TAG, name: TITLE, body: NOTES, draft: false, prerelease: PRERELEASE })
  });
  if (res.ok) return res.json();
  if (res.status !== 422) throw new Error(`Erro ao criar release (${res.status}): ${await res.text()}`);

  console.log(`Release ${TAG} já existe; atualizando notas e arquivos.`);
  const existing = await api(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`);
  if (!existing.ok) throw new Error(`Erro ao buscar release existente: ${await existing.text()}`);
  const release = await existing.json();
  await api(`https://api.github.com/repos/${REPO}/releases/${release.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: TITLE, body: NOTES, prerelease: PRERELEASE })
  });
  return release;
}

async function upload(release, file) {
  const githubName = file.name.replace(/ /g, '.'); // o GitHub troca espaços por pontos
  const old = release.assets?.find((a) => a.name === githubName || a.name === file.name);
  if (old) {
    console.log(`Substituindo ${old.name}...`);
    await api(`https://api.github.com/repos/${REPO}/releases/assets/${old.id}`, { method: 'DELETE' });
  }
  const size = fs.statSync(file.path).size;
  const base = release.upload_url.split('{')[0];
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Enviando ${file.name} (${(size / 1024 / 1024).toFixed(1)} MB, tentativa ${attempt}/3)...`);
    const res = await api(`${base}?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      duplex: 'half',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
      body: fs.createReadStream(file.path)
    });
    if (res.ok) {
      console.log(`✓ ${file.name}`);
      return;
    }
    console.warn(`Falhou (${res.status}): ${await res.text()}`);
  }
  throw new Error(`Não foi possível enviar ${file.name}`);
}

async function main() {
  if (!TOKEN) {
    console.error('Defina GH_TOKEN (ou faça `gh auth login` e rode: $env:GH_TOKEN = gh auth token).');
    process.exit(1);
  }
  const missing = FILES.filter((f) => !fs.existsSync(f.path));
  if (missing.length) {
    console.error(`Executáveis não encontrados: ${missing.map((f) => f.name).join(', ')}. Rode "npm run dist" antes.`);
    process.exit(1);
  }
  console.log(`[1/2] Release ${TAG} em ${REPO}...`);
  const release = await getOrCreateRelease();
  console.log(`[2/2] Enviando executáveis...`);
  for (const file of FILES) await upload(release, file);
  if (fs.existsSync(WEB_BUNDLE.path)) await upload(release, WEB_BUNDLE);
  else console.warn(`Sem pacote web (${WEB_BUNDLE.name}); a versão no navegador continua na anterior.`);
  console.log(`Pronto: ${release.html_url}`);
}

main().catch((err) => {
  console.error('Falha ao publicar a release:', err.message);
  process.exit(1);
});
