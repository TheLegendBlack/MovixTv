import React, { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';

/**
 * Code de liaison affiché par le téléviseur, avec son QR code (26/10/2026).
 *
 * Repris de l'appli TV native de Movix : plutôt que de taper un code à la
 * télécommande, on lit celui de la télé avec son téléphone. Le QR mène à la
 * page qui confirme le code ; le code reste lisible pour qui saisit l'adresse
 * à la main.
 *
 * Le QR est dessiné en SVG, un seul chemin : aucun canvas ni image à décoder
 * sur un SoC lent. Noir sur blanc quel que soit le thème : un lecteur de QR
 * a besoin de ce contraste, et d'une marge claire de quatre modules autour.
 */

export const TvQrCode: React.FC<{ value: string; size: number; className?: string }> = ({ value, size, className = '' }) => {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const modules = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { count: modules, path: d };
  }, [value]);
  const margin = 4;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-margin} ${-margin} ${count + margin * 2} ${count + margin * 2}`}
      shapeRendering="crispEdges"
      className={'rounded-xl ' + className}
      role="img"
      aria-label={`QR code : ${value}`}>
      <rect x={-margin} y={-margin} width={count + margin * 2} height={count + margin * 2} className="fill-white" />
      <path d={path} className="fill-black" />
    </svg>
  );
};

/** Secondes restantes jusqu'à `expiresAt`, rafraîchies chaque seconde. */
export function useSecondsLeft(expiresAt: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
}

export const TvLinkCode: React.FC<{
  code: string;
  /** Adresse encodée dans le QR (code compris). */
  url: string;
  /** Adresse à taper pour qui n'a pas de lecteur de QR. */
  manualUrl: string;
  expiresAt: number;
}> = ({ code, url, manualUrl, expiresAt }) => {
  const left = useSecondsLeft(expiresAt);
  return (
    <div className="flex items-center gap-6">
      <TvQrCode value={url} size={168} className="shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] text-white/55">Scannez le QR code, ou ouvrez</p>
        <p className="truncate text-[16px] font-semibold">{manualUrl}</p>
        <p className="mt-3 text-[13px] text-white/55">et saisissez ce code :</p>
        <p className="mt-1 font-mono text-[34px] font-bold leading-none tracking-[0.18em]" aria-live="polite">
          {code}
        </p>
        <p className="mt-3 flex items-center gap-2 text-[13px] text-white/50" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-movix-red-bright" aria-hidden />
          En attente · encore {Math.floor(left / 60)} min {String(left % 60).padStart(2, '0')} s
        </p>
      </div>
    </div>
  );
};
