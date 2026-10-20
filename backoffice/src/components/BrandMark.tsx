import { t } from '@/texts';

/** Logo orizzontale piccolo (D219), copiato dal kit con npm run tokens. */
export function BrandMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG statico del kit, senza ottimizzazione
    <img
      className="brand-mark"
      src="/brand/logo-orizzontale-piccolo-positivo.svg"
      alt={`${t('brand.swipe')} ${t('brand.amp')} ${t('brand.slide')}`}
      width={176}
      height={26}
    />
  );
}
