import { useRef, useState } from 'react';

/** Arrastar arquivos para uma área: `dragging` liga o aviso visual; `onFiles` recebe o que foi solto. */
export function useFileDrop(onFiles) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0); // dragenter/dragleave disparam em cada filho: conta para não piscar
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  const dropHandlers = {
    onDragEnter: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      onFiles(e.dataTransfer.files);
    }
  };
  return { dragging, dropHandlers };
}
