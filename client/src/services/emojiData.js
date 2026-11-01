/**
 * Emojis do seletor: uma seleção dos mais usados, com palavras-chave em português para a busca.
 * Formato: [emoji, palavras-chave]. Leve de propósito (sem baixar bibliotecas de emoji).
 */
export const EMOJI_CATEGORIES = [
  {
    id: 'rostos',
    label: 'Rostos',
    icon: '😀',
    emojis: [
      ['😀', 'sorriso feliz'], ['😃', 'sorriso feliz alegre'], ['😄', 'sorriso olhos feliz'], ['😁', 'sorrisao dentes'],
      ['😆', 'rindo risada'], ['😅', 'rindo suor nervoso'], ['🤣', 'rolando de rir kkk'], ['😂', 'chorando de rir kkk lagrimas'],
      ['🙂', 'sorriso leve'], ['🙃', 'de cabeca para baixo ironia'], ['😉', 'piscadinha'], ['😊', 'corado feliz fofo'],
      ['😇', 'anjo inocente'], ['🥰', 'apaixonado coracoes'], ['😍', 'olhos de coracao apaixonado'], ['🤩', 'estrelas incrivel'],
      ['😘', 'beijo'], ['😋', 'gostoso delicia lingua'], ['😛', 'lingua'], ['😜', 'piscando lingua zoeira'],
      ['🤪', 'maluco doido'], ['🤑', 'dinheiro rico'], ['🤗', 'abraco'], ['🤭', 'ops mao na boca'],
      ['🤫', 'silencio segredo'], ['🤔', 'pensando hmm duvida'], ['🤐', 'boca fechada ziper'], ['🤨', 'sobrancelha desconfiado'],
      ['😐', 'neutro serio'], ['😑', 'sem expressao'], ['😶', 'sem boca'], ['😏', 'sorriso de lado malicia'],
      ['😒', 'tedio insatisfeito'], ['🙄', 'revirando olhos'], ['😬', 'careta constrangido'], ['🤥', 'mentiroso pinoquio'],
      ['😌', 'aliviado'], ['😔', 'pensativo triste'], ['😪', 'sono'], ['😴', 'dormindo zzz'],
      ['😷', 'mascara doente'], ['🤒', 'febre doente'], ['🤢', 'enjoado nojo'], ['🤮', 'vomitando nojo'],
      ['🥵', 'calor quente'], ['🥶', 'frio congelando'], ['🥴', 'tonto bebado'], ['😵', 'tonto atordoado'],
      ['🤯', 'cabeca explodindo chocado'], ['🤠', 'cowboy'], ['🥳', 'festa comemorando'], ['😎', 'oculos escuros estiloso'],
      ['🤓', 'nerd'], ['🧐', 'monoculo analisando'], ['😕', 'confuso'], ['😟', 'preocupado'],
      ['🙁', 'triste'], ['😮', 'surpreso boca aberta'], ['😯', 'espantado'], ['😲', 'chocado'],
      ['😳', 'envergonhado corado'], ['🥺', 'por favor olhinhos'], ['😦', 'assustado'], ['😨', 'medo'],
      ['😰', 'ansioso suor'], ['😥', 'decepcionado aliviado'], ['😢', 'chorando lagrima triste'], ['😭', 'chorando muito'],
      ['😱', 'gritando medo'], ['😖', 'confuso frustrado'], ['😣', 'perseverante'], ['😞', 'decepcionado'],
      ['😓', 'suor frio'], ['😩', 'cansado exausto'], ['😫', 'cansado'], ['🥱', 'bocejo sono tedio'],
      ['😤', 'bufando triunfo'], ['😡', 'bravo raiva'], ['😠', 'irritado'], ['🤬', 'xingando palavrao'],
      ['😈', 'diabinho'], ['💀', 'caveira morri kkk'], ['💩', 'coco'], ['🤡', 'palhaco'],
      ['👻', 'fantasma'], ['👽', 'alien'], ['🤖', 'robo'], ['🫠', 'derretendo'],
      ['🫡', 'continencia saudacao'], ['🫣', 'espiando vergonha'], ['🥲', 'sorriso com lagrima'], ['😮‍💨', 'suspiro alivio']
    ]
  },
  {
    id: 'gestos',
    label: 'Pessoas e gestos',
    icon: '👍',
    emojis: [
      ['👍', 'joinha positivo sim like'], ['👎', 'negativo nao dislike'], ['👏', 'palmas aplausos'], ['🙌', 'maos para cima viva'],
      ['🙏', 'por favor obrigado reza'], ['🤝', 'aperto de mao acordo'], ['👋', 'tchau oi aceno'], ['✌️', 'paz vitoria'],
      ['🤞', 'dedos cruzados sorte'], ['🤟', 'te amo rock'], ['🤘', 'rock'], ['👌', 'ok perfeito'],
      ['🤌', 'italiano'], ['👈', 'esquerda'], ['👉', 'direita'], ['👆', 'cima'],
      ['👇', 'baixo'], ['☝️', 'atencao um'], ['✋', 'mao pare'], ['🖐️', 'mao aberta'],
      ['💪', 'forca musculo'], ['🫶', 'coracao com as maos'], ['👀', 'olhos olhando'], ['🧠', 'cerebro'],
      ['🤷', 'sei la tanto faz'], ['🤦', 'facepalm vergonha'], ['🙋', 'eu levantando mao'], ['🙅', 'nao proibido'],
      ['🙆', 'ok'], ['💁', 'informacao'], ['🗿', 'moai serio'], ['🫵', 'voce apontando']
    ]
  },
  {
    id: 'coracoes',
    label: 'Corações e símbolos',
    icon: '❤️',
    emojis: [
      ['❤️', 'coracao amor vermelho'], ['🧡', 'coracao laranja'], ['💛', 'coracao amarelo'], ['💚', 'coracao verde'],
      ['💙', 'coracao azul'], ['💜', 'coracao roxo'], ['🖤', 'coracao preto'], ['🤍', 'coracao branco'],
      ['💔', 'coracao partido'], ['💕', 'coracoes'], ['💖', 'coracao brilhando'], ['💯', 'cem perfeito'],
      ['✅', 'certo check feito'], ['❌', 'errado x nao'], ['⚠️', 'atencao aviso'], ['❓', 'pergunta'],
      ['❗', 'exclamacao'], ['‼️', 'dupla exclamacao'], ['💤', 'zzz sono'], ['💢', 'raiva'],
      ['💥', 'explosao'], ['✨', 'brilho'], ['🔥', 'fogo top'], ['⭐', 'estrela'],
      ['🌟', 'estrela brilhando'], ['⚡', 'raio energia'], ['💫', 'tonto estrela'], ['🎵', 'musica nota'],
      ['🆗', 'ok'], ['🆕', 'novo'], ['🔴', 'vermelho ao vivo'], ['🟢', 'verde online']
    ]
  },
  {
    id: 'natureza',
    label: 'Animais e natureza',
    icon: '🐶',
    emojis: [
      ['🐶', 'cachorro'], ['🐱', 'gato'], ['🐭', 'rato'], ['🐹', 'hamster'],
      ['🐰', 'coelho'], ['🦊', 'raposa'], ['🐻', 'urso'], ['🐼', 'panda'],
      ['🐨', 'coala'], ['🐯', 'tigre'], ['🦁', 'leao'], ['🐮', 'vaca'],
      ['🐷', 'porco'], ['🐸', 'sapo'], ['🐵', 'macaco'], ['🙈', 'macaco nao vejo'],
      ['🙉', 'macaco nao ouco'], ['🙊', 'macaco nao falo'], ['🐔', 'galinha'], ['🐧', 'pinguim'],
      ['🐦', 'passaro'], ['🦆', 'pato'], ['🦅', 'aguia'], ['🦉', 'coruja'],
      ['🐺', 'lobo'], ['🐗', 'javali'], ['🐴', 'cavalo'], ['🦄', 'unicornio'],
      ['🐝', 'abelha'], ['🐛', 'lagarta'], ['🦋', 'borboleta'], ['🐌', 'caracol lento'],
      ['🐢', 'tartaruga lento'], ['🐍', 'cobra'], ['🦖', 'dinossauro'], ['🐙', 'polvo'],
      ['🦈', 'tubarao'], ['🐬', 'golfinho'], ['🐟', 'peixe'], ['🦀', 'caranguejo'],
      ['🌹', 'rosa flor'], ['🌻', 'girassol'], ['🌵', 'cacto'], ['🌴', 'palmeira'],
      ['🍀', 'trevo sorte'], ['🌈', 'arco iris'], ['☀️', 'sol'], ['🌙', 'lua'],
      ['⛈️', 'tempestade chuva'], ['❄️', 'neve frio'], ['🌊', 'onda mar'], ['🌍', 'mundo terra']
    ]
  },
  {
    id: 'comida',
    label: 'Comidas e bebidas',
    icon: '🍕',
    emojis: [
      ['🍕', 'pizza'], ['🍔', 'hamburguer'], ['🍟', 'batata frita'], ['🌭', 'cachorro quente'],
      ['🌮', 'taco'], ['🍣', 'sushi'], ['🍜', 'lamen'], ['🍝', 'macarrao'],
      ['🍗', 'frango'], ['🥩', 'carne churrasco'], ['🥓', 'bacon'], ['🍳', 'ovo'],
      ['🧀', 'queijo'], ['🥪', 'sanduiche'], ['🍿', 'pipoca'], ['🍩', 'rosquinha donut'],
      ['🍪', 'biscoito cookie'], ['🎂', 'bolo aniversario'], ['🍰', 'bolo fatia'], ['🍫', 'chocolate'],
      ['🍦', 'sorvete'], ['🍎', 'maca'], ['🍌', 'banana'], ['🍉', 'melancia'],
      ['🍓', 'morango'], ['🍇', 'uva'], ['🥑', 'abacate'], ['🌶️', 'pimenta'],
      ['☕', 'cafe'], ['🍺', 'cerveja'], ['🍻', 'brinde cervejas'], ['🍷', 'vinho'],
      ['🥂', 'brinde champanhe'], ['🍹', 'drink'], ['🧃', 'suco caixinha'], ['🥤', 'refrigerante']
    ]
  },
  {
    id: 'atividades',
    label: 'Atividades e objetos',
    icon: '🎮',
    emojis: [
      ['🎮', 'videogame jogo controle'], ['🕹️', 'joystick'], ['🎯', 'alvo'], ['🎲', 'dado'],
      ['🧩', 'quebra cabeca'], ['♟️', 'xadrez'], ['🏆', 'trofeu campeao'], ['🥇', 'medalha ouro primeiro'],
      ['🥈', 'medalha prata'], ['🥉', 'medalha bronze'], ['⚽', 'futebol bola'], ['🏀', 'basquete'],
      ['🏐', 'volei'], ['🎾', 'tenis'], ['🏎️', 'carro corrida'], ['🎉', 'festa confete'],
      ['🎊', 'confete'], ['🎈', 'balao'], ['🎁', 'presente'], ['🎧', 'fone musica'],
      ['🎤', 'microfone karaoke'], ['🎸', 'guitarra'], ['🎬', 'filme cinema'], ['📺', 'televisao'],
      ['💻', 'computador notebook'], ['🖥️', 'monitor pc'], ['⌨️', 'teclado'], ['🖱️', 'mouse'],
      ['📱', 'celular'], ['📷', 'camera foto'], ['💡', 'ideia lampada'], ['🔔', 'sino notificacao'],
      ['📌', 'fixar alfinete'], ['📎', 'clipe anexo'], ['🔒', 'cadeado'], ['🔑', 'chave'],
      ['💰', 'dinheiro saco'], ['💸', 'dinheiro voando gasto'], ['💎', 'diamante'], ['🚀', 'foguete'],
      ['✈️', 'aviao viagem'], ['🚗', 'carro'], ['🏠', 'casa'], ['⏰', 'despertador hora'],
      ['⌛', 'ampulheta tempo'], ['📅', 'calendario'], ['🍆', 'berinjela'], ['🍑', 'pessego']
    ]
  }
];

export const QUICK_REACTIONS = ['👍', '😂', '❤️', '🔥', '😮', '😢'];

const RECENT_KEY = 'resenha.recentEmojis';

export function getRecentEmojis() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.slice(0, 16) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji) {
  try {
    const list = [emoji, ...getRecentEmojis().filter((e) => e !== emoji)].slice(0, 16);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* sem armazenamento: só não lembra os recentes */
  }
}

/** Busca sem acento e sem diferenciar maiúsculas. */
export function searchEmojis(query) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return [];
  const out = [];
  for (const cat of EMOJI_CATEGORIES) {
    for (const [emoji, keywords] of cat.emojis) {
      if (norm(keywords).includes(q)) out.push(emoji);
    }
  }
  return out;
}
