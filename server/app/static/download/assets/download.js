// Mostra a versão e o tamanho do instalador. Se falhar, o botão continua indo para /download/windows.
(async () => {
  try {
    const res = await fetch('/api/download', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const info = await res.json();
    const parts = [`Versão ${info.version}`];
    if (info.setup_size) parts.push(`${Math.round(info.setup_size / 1024 / 1024)} MB`);
    document.querySelector('[data-meta]').textContent = parts.join(' · ');
    if (info.portable_url) document.querySelector('[data-portable]').href = info.portable_url;
  } catch {
    // sem rede ou servidor antigo: fica o texto padrão
  }
})();
