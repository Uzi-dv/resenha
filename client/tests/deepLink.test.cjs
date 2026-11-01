// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { parseInviteLink, inviteCodeFromArgv } = require('../electron/deepLink.cjs');

test('extrai o código de resenha://convite/<código>', () => {
  assert.strictEqual(parseInviteLink('resenha://convite/AbC12xyZ'), 'AbC12xyZ');
  assert.strictEqual(parseInviteLink('resenha://convite/AbC12xyZ/'), 'AbC12xyZ'); // barra que o Windows acrescenta
  assert.strictEqual(parseInviteLink('RESENHA://Convite/AbC12xyZ'), 'AbC12xyZ');
  assert.strictEqual(parseInviteLink('resenha://convite/AbC12xyZ?from=web#x'), 'AbC12xyZ');
  assert.strictEqual(parseInviteLink('"resenha://convite/old_Code-1"'), 'old_Code-1'); // código antigo (token_urlsafe)
  assert.strictEqual(parseInviteLink('resenha://invite/AbC12xyZ'), 'AbC12xyZ');
});

test('recusa o que não é convite válido', () => {
  for (const bad of [
    'resenha://convite/', 'resenha://convite/abc', 'resenha://convite/a b c d', 'resenha://convite/../../x',
    'resenha://convite/' + 'a'.repeat(33), 'https://resenha.example/convite/AbC12xyZ', 'resenha://outra/AbC12xyZ',
    'resenha://convite/AbC12xyZ/extra', 'resenha://convite/<script>', null, undefined, 42
  ]) {
    assert.strictEqual(parseInviteLink(bad), null, String(bad));
  }
});

test('encontra o link no meio da linha de comando', () => {
  const winArgv = ['C:\\Program Files\\Resenha\\Resenha.exe', '--allow-file-access-from-files', 'resenha://convite/AbC12xyZ/'];
  assert.strictEqual(inviteCodeFromArgv(winArgv), 'AbC12xyZ');
  const devArgv = ['electron.exe', 'C:\\dev\\resenha-client', '--', 'resenha://convite/Zz99Yy88'];
  assert.strictEqual(inviteCodeFromArgv(devArgv), 'Zz99Yy88');
  assert.strictEqual(inviteCodeFromArgv(['Resenha.exe', '--hidden']), null);
  assert.strictEqual(inviteCodeFromArgv(undefined), null);
});
