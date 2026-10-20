import type { PhotoRef } from '@/server/admin-api/types';

/**
 * Foto del profilo in revisione. Nei dati finti non c'è un'immagine: si mostra la sagoma sul fondo
 * segnaposto del brand (token `placeholder.*`).
 */
export function Photo({
  photo,
  variant,
  label,
}: {
  photo: PhotoRef | null;
  variant: 'avatar' | 'large';
  label?: string;
}) {
  const tone = photo?.placeholder ?? 'sand';
  const className = `photo photo--${variant} photo--${tone}`;
  if (photo?.url) {
    // eslint-disable-next-line @next/next/no-img-element -- URL firmato di breve durata, da non ottimizzare
    return <img className={className} src={photo.url} alt={label ?? ''} />;
  }
  return (
    <span className={className} role={label ? 'img' : undefined} aria-label={label}>
      <svg viewBox="0 0 40 46" aria-hidden="true" focusable="false" className="photo__silhouette">
        <circle cx="20" cy="15" r="8" />
        <path d="M4 46c0-10 7-16 16-16s16 6 16 16z" />
      </svg>
    </span>
  );
}
