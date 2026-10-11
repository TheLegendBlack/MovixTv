import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TV_SCALE } from './tvScale';
import { readPerfRecord } from './devicePerformance';
import { getTvDetection } from '@/utils/tv/isTvDevice';
import { useFocusScope } from './nav/hooks';
import { TV_TOP_NAV_SCOPE, TvTopNav } from './components/TvTopNav';
import { TV_SAFE_X } from './components/TvRow';
import { getAccessKey } from '@/utils/vipUtils';
import { getStoredTmdbKey } from '@/config/tmdbKey';
import { useEditionSettingsEntries } from './edition';
import { KeyLine, type SettingsEntry } from './settings/settingsEntry';
import {
  getNativeAdBlockState,
  hasNativeAdBlock,
  setNativeAdBlockEnabled,
  type NativeAdBlockState,
} from '@/utils/tv/nativeAdBlock';
import {
  TvChoice,
  TvIcon,
  TvPanel,
  TvStatusDot,
  maskKey,
  useStickyFocusedIndex,
} from './settings/kit';

/**
 * Réglages de l'interface téléviseur.
 *
 * Recueille ce qui n'a pas sa place sur l'accueil : le diagnostic matériel et
 * le retour à l'interface souris encombraient la première chose qu'on voit en
 * allumant la télé, alors qu'on s'en sert une fois sur cent.
 *
 * Disposition des réglages de salon : une liste à gauche, et à droite le
 * détail du réglage sous le focus — son état, ce qu'il fait, ce que fait OK.
 * La liste reste courte (une ligne par réglage) et le document ne défile pas.
 */

const SCOPE = 'reglages';

const TvSettings: React.FC = () => {
  const navigate = useNavigate();
  const detection = React.useMemo(() => getTvDetection(), []);
  const perf = React.useMemo(() => readPerfRecord(), []);

  // Bloqueur natif : présent uniquement dans l'application TV.
  const [adBlock, setAdBlock] = React.useState<NativeAdBlockState | null>(null);
  React.useEffect(() => {
    if (!hasNativeAdBlock()) return;
    getNativeAdBlockState().then(setAdBlock).catch(() => setAdBlock(null));
  }, []);

  const vipKey = getAccessKey();
  const vipValid = localStorage.getItem('is_vip') === 'true';
  const tmdbStored = getStoredTmdbKey();
  const tmdbEnv = Boolean(import.meta.env.VITE_TMDB_API_KEY);
  // Lignes propres à l'édition (`edition.tsx`), en tête de liste.
  const editionEntries = useEditionSettingsEntries(navigate);

  const entries: SettingsEntry[] = [
    ...editionEntries,
    {
      id: 'vip',
      group: 'Accès',
      label: 'Clé VIP Movix',
      icon: 'key',
      value: vipKey ? (vipValid ? 'Valide' : 'Non vérifiée') : 'Absente',
      tone: vipKey ? (vipValid ? 'ok' : 'warn') : 'off',
      chevron: true,
      description: 'Donne accès aux sources de lecture résolues par Movix.',
      details: vipKey ? <KeyLine value={maskKey(vipKey)} /> : undefined,
      action: 'OK : saisir ou changer la clé',
      onSelect: () => navigate('/tvapp/settings/key/vip'),
    },
    {
      id: 'tmdb',
      group: 'Accès',
      label: 'Clé TMDB',
      icon: 'film',
      value: tmdbStored ? 'Renseignée' : tmdbEnv ? 'Fichier .env' : 'Absente',
      tone: tmdbStored || tmdbEnv ? 'ok' : 'error',
      chevron: true,
      description: tmdbStored
        ? 'Affiches, résumés et rangées utilisent la clé saisie dans l’application.'
        : tmdbEnv
          ? 'Affiches, résumés et rangées utilisent la clé du fichier .env. Une clé saisie ici la remplace.'
          : 'Sans clé TMDB, les affiches, résumés et rangées ne peuvent pas se charger.',
      details: tmdbStored ? <KeyLine value={maskKey(tmdbStored)} /> : undefined,
      action: 'OK : saisir ou changer la clé',
      onSelect: () => navigate('/tvapp/settings/key/tmdb'),
    },
    ...(hasNativeAdBlock()
      ? [
          {
            id: 'adblock',
            group: 'Lecture',
            label: 'Bloqueur de publicités',
            icon: 'shield' as const,
            toggle: adBlock ? adBlock.enabled : undefined,
            value: adBlock ? undefined : 'Indisponible',
            tone: adBlock ? undefined : ('off' as const),
            description: !adBlock
              ? 'Le bloqueur de l’application ne répond pas.'
              : adBlock.enabled
                ? 'Les requêtes publicitaires des lecteurs embarqués sont bloquées.'
                : 'Désactivé : les lecteurs embarqués affichent leurs publicités.',
            details:
              adBlock && adBlock.enabled ? (
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-[32px] font-black leading-none tabular-nums">{adBlock.blocked}</span>
                  <span className="text-[14px] text-white/55">
                    requête{adBlock.blocked > 1 ? 's' : ''} bloquée{adBlock.blocked > 1 ? 's' : ''} depuis le démarrage
                  </span>
                </p>
              ) : undefined,
            action: adBlock?.enabled ? 'OK : désactiver' : 'OK : activer',
            onSelect: () => {
              setNativeAdBlockEnabled(!(adBlock?.enabled ?? true))
                .then(setAdBlock)
                .catch(() => {});
            },
          },
        ]
      : []),
    {
      id: 'diag',
      group: 'Système',
      label: 'Diagnostic matériel',
      icon: 'pulse',
      chevron: true,
      description: 'Codecs, DRM, télécommande et fréquence d’images de ce téléviseur.',
      details: (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-white/40">Détection</dt>
          <dd className="truncate text-white/75">
            {detection.isTv ? 'téléviseur' : 'non-TV'} via {detection.source}
          </dd>
          <dt className="text-white/40">Viewport</dt>
          <dd className="text-white/75 tabular-nums">
            {window.innerWidth}×{window.innerHeight}
          </dd>
          <dt className="text-white/40">Échelle</dt>
          <dd className="text-white/75">{TV_SCALE === 1 ? '1 (gabarit natif)' : TV_SCALE}</dd>
          <dt className="text-white/40">Palier</dt>
          <dd className="text-white/75">{perf ? `${perf.tier} (${perf.fps} i/s)` : 'non mesuré'}</dd>
        </dl>
      ),
      action: 'OK : lancer le diagnostic',
      onSelect: () => navigate('/tvapp/diag'),
    },
  ];

  const scopeRef = useFocusScope({
    id: SCOPE,
    orientation: 'column',
    count: entries.length,
    neighbors: { up: TV_TOP_NAV_SCOPE, down: null },
  });
  const activeIndex = Math.min(useStickyFocusedIndex(SCOPE), entries.length - 1);
  const active = entries[activeIndex];

  // Budget vertical, viewport de 540 px : six lignes au plus. Une septième
  // sortait de l'écran sur l'Edenwood (11/10/2026) ; « Interface classique »,
  // qui renvoyait sur l'accueil TV depuis le retrait du site souris, a été
  // retirée à cette occasion. Toute nouvelle ligne doit en remplacer une.
  return (
    <div className="flex h-[var(--tv-screen-height,100vh)] flex-col overflow-hidden">
      <TvTopNav neighbors={{ down: SCOPE }} />
      <div className="flex min-h-0 flex-1 flex-col pb-6" style={{ paddingLeft: TV_SAFE_X, paddingRight: TV_SAFE_X }}>
        <h1 className="mb-3 text-[24px] font-black leading-8 tracking-tight">Paramètres</h1>
        <div className="flex min-h-0 flex-1 items-start gap-8">
          <div ref={scopeRef} className="flex w-[380px] shrink-0 flex-col">
            {entries.map((entry, index) => (
              <TvChoice
                key={entry.id}
                scopeId={SCOPE}
                index={index}
                icon={entry.icon}
                label={entry.label}
                value={
                  entry.value ? (
                    <>
                      {entry.tone && <TvStatusDot tone={entry.tone} />}
                      {entry.value}
                    </>
                  ) : undefined
                }
                toggle={entry.toggle}
                chevron={entry.chevron}
                onSelect={entry.onSelect}
                className={
                  'py-1.5 ' + (index === 0 ? '' : entries[index - 1].group !== entry.group ? 'mt-3.5' : 'mt-1.5')
                }
              />
            ))}
          </div>

          <TvPanel className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-movix-red/15 text-movix-red-bright">
              <TvIcon name={active.icon} size={24} />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/40">{active.group}</p>
              <h2 className="truncate text-[21px] font-black leading-tight">{active.label}</h2>
            </div>
          </div>
          {(active.value || active.toggle !== undefined) && (
            <p className="mt-3 flex items-center gap-2 text-[14px] font-semibold">
              {active.toggle !== undefined ? (
                <>
                  <TvStatusDot tone={active.toggle ? 'ok' : 'off'} />
                  {active.toggle ? 'Activé' : 'Désactivé'}
                </>
              ) : (
                <>
                  {active.tone && <TvStatusDot tone={active.tone} />}
                  {active.value}
                </>
              )}
            </p>
          )}
          <p className="mt-3 text-[15px] leading-relaxed text-white/65">{active.description}</p>
          {active.details}
          <p className="mt-5 border-t border-white/10 pt-3 text-[13px] text-white/40">{active.action}</p>
          </TvPanel>
        </div>
      </div>
    </div>
  );
};


export default TvSettings;
