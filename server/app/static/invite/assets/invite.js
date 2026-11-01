(() => {
  const body = document.body;
  const code = body.dataset.code;
  const status = document.querySelector('[data-status]');
  const openLink = document.querySelector('[data-open-app]');

  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const isWindows = /Windows/i.test(ua) && !isMobile;
  if (!isWindows) body.classList.add('no-app');

  const counts = (online, members) => `${online} online · ${members} ${members === 1 ? 'membro' : 'membros'}`;

  // Atualiza os contadores (o HTML já veio preenchido pelo servidor)
  if (code && body.dataset.state === 'valid') {
    fetch(`/api/invites/${encodeURIComponent(code)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) {
          body.dataset.state = 'invalid';
          return;
        }
        const el = document.querySelector('[data-counts-text]');
        if (el) el.textContent = counts(data.online, data.members);
      })
      .catch(() => {});
  }

  if (!isWindows || !code || body.dataset.state !== 'valid') return;

  // Tenta abrir o app uma vez. Não dá para saber com certeza se ele está instalado: se a janela
  // perder o foco logo depois, o navegador entregou o link para o Resenha.
  let opened = false;
  const onHidden = () => {
    if (opened) return;
    opened = true;
    status.textContent = 'Abrimos o Resenha para você.';
  };
  const watch = () => {
    window.addEventListener('blur', onHidden, { once: true });
    document.addEventListener('visibilitychange', () => document.hidden && onHidden(), { once: true });
  };

  const tryOpen = () => {
    status.textContent = 'Abrindo o Resenha…';
    watch();
    window.location.href = openLink.href;
    setTimeout(() => {
      if (!opened) status.textContent = 'Se o Resenha não abriu, é só usar um dos botões.';
    }, 1500);
  };
  // Depois de a página terminar de carregar, para o pedido ao sistema não atrapalhar o carregamento
  if (document.readyState === 'complete') tryOpen();
  else window.addEventListener('load', tryOpen, { once: true });

  openLink.addEventListener('click', () => {
    opened = false;
    status.textContent = 'Abrindo o Resenha…';
    watch();
  });
})();
