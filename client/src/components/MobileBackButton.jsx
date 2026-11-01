import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { showMobileNav, useIsMobile } from '../services/mobile';

/** "Voltar" no topo do chat, da call e da DM. Só aparece no layout de celular. */
export default function MobileBackButton() {
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <button
      onClick={showMobileNav}
      className="-ml-2 mr-1 w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-fg-2 hover:text-fg-strong hover:bg-hover"
      title="Voltar"
      aria-label="Voltar"
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  );
}
