/**
 * Prepara uma release automática (usado pelo CI a cada merge na main).
 *
 * Versão:
 *   - Se o package.json tem versão MAIOR que a última release publicada, usa essa
 *     (bump manual: notas vêm do RELEASE_NOTES.md).
 *   - Senão, incrementa o patch da última release (notas geradas pelos commits).
 *
 * Grava a versão no package.json (só no workspace do CI), escreve RELEASE_NOTES.md com
 * um marcador do commit de origem (para a próxima release saber de onde partir) e
 * exporta `version` em $GITHUB_OUTPUT.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
function releasesRepo() {
  if (process.env.GH_REPO) return process.env.GH_REPO;
  const publish = (require(path.join(__dirname, '..', 'package.json')).build?.publish || [])[0] || {};
  if (publish.owner && publish.repo && publish.owner !== 'SEU-USUARIO-DO-GITHUB') return `${publish.owner}/${publish.repo}`;
  console.error('Defina GH_REPO (ex.: seu-usuario/resenha-releases) ou build.publish no package.json.');
  process.exit(1);
}
const REPO = releasesRepo();
const TOKEN = process.env.GH_TOKEN;
const SHA = process.env.GITHUB_SHA || execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
const MARKER = /<!--\s*resenha-source:\s*([0-9a-f]{7,40})\s*-->/;

const parse = (v) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
const cmp = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Resenha-CI', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Falha ao consultar a última release: HTTP ${res.status}`);
  return res.json();
}

function commitsSince(baseSha) {
  const range = baseSha ? `${baseSha}..${SHA}` : `-15 ${SHA}`;
  try {
    return execSync(`git log ${range} --no-merges --format=%s`, { cwd: ROOT })
      .toString()
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !/^(chore\(release\)|docs|ci|test|tests)(\(|:)/i.test(s));
  } catch {
    return [];
  }
}

const INSTALL_SECTION = (v) => `### Instalação
- **\`Resenha-Setup-${v}.exe\`**: instalador recomendado (se atualiza sozinho).
- **\`Resenha-Portable-${v}.exe\`**: versão portátil, é só abrir (sem atualização automática).

Quem já usa a versão instalada recebe esta atualização sozinho.

O Windows pode mostrar o aviso "O Windows protegeu o computador", porque o app não tem assinatura digital: clique em **Mais informações → Executar assim mesmo**.`;

async function main() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const latest = await latestRelease();
  const latestVersion = latest?.tag_name?.replace(/^v/, '') || '0.0.0';
  const previousSha = latest?.body?.match(MARKER)?.[1] || null;

  const autoNotes = (v) => {
    const changes = commitsSince(previousSha);
    const list = changes.length ? changes.map((c) => `- ${c}`).join('\n') : '- Melhorias e correções internas.';
    console.log(`${changes.length} mudança(s) desde ${previousSha || 'o início'}`);
    return `## Resenha v${v}\n\n### O que mudou\n${list}\n\n${INSTALL_SECTION(v)}`;
  };

  let version;
  let notes;
  if (cmp(pkg.version, latestVersion) > 0) {
    version = pkg.version;
    console.log(`Versão manual do package.json: ${version} (última publicada: ${latestVersion})`);
    const notesFile = path.join(ROOT, 'RELEASE_NOTES.md');
    const manual = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '';
    // Só usa o RELEASE_NOTES.md se ele foi atualizado para esta versão
    if (manual.split('\n')[0].includes(`v${version}`)) {
      notes = manual.replace(MARKER, '').trim();
    } else {
      console.log(`RELEASE_NOTES.md não é da v${version}; gerando notas a partir dos commits.`);
      notes = autoNotes(version);
    }
  } else {
    const [major, minor, patch] = parse(latestVersion);
    version = `${major}.${minor}.${patch + 1}`;
    console.log(`Versão automática: ${latestVersion} -> ${version}`);
    notes = autoNotes(version);
  }

  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), `${notes}\n\n<!-- resenha-source: ${SHA} -->\n`);

  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
