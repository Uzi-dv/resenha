import React, { useState } from 'react';
import { avatarUrl, defaultAvatarUrl } from '../services/api';

/** Foto do usuário com fallback automático se o link quebrar ou a imagem não carregar. */
export default function Avatar({ user, alt = '', ...props }) {
  const src = avatarUrl(user);
  const [failedSrc, setFailedSrc] = useState(null);
  return (
    <img
      src={failedSrc === src ? defaultAvatarUrl(user) : src}
      onError={() => setFailedSrc(src)}
      alt={alt}
      draggable={false}
      {...props}
    />
  );
}
