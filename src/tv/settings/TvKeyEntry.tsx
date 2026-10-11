import React, { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TvKeyboard, TV_KEYBOARD_WIDTH, tvKeyboardScopes } from '../components/TvKeyboard';
import { BACK_SCOPE, TvChoice, TvIcon, TvStatusDot, TvSubpage, maskKey, useInitialFocus, type TvIconName } from './kit';
import { useFocusScope } from '../nav/hooks';
import { checkVipStatus, getAccessKey, revokeVipStatus } from '@/utils/vipUtils';
import { getStoredTmdbKey, setStoredTmdbKey, validateTmdbKey } from '@/config/tmdbKey';

/**
 * Saisie d'une clé au clavier virtuel : la clé VIP Movix ou la clé TMDB.
 *
 * C'est elle qui lève le blocage du portage en APK, où `main.tsx` n'amorce
 * plus la clé VIP du `.env`.
 *
 * Chaque clé est vérifiée auprès de son service avant d'être gardée. Pendant
 * la saisie, l'écran signale ce qui ne ressemble pas au format attendu, sans
 * rien bloquer : seul le service fait foi.
 */

type KeyKind = 'vip' | 'tmdb';

/*
 * Budget vertical (viewport de 540 px). Clavier : rangée d'actions 32 + 4,
 * puis touches de 32 sur six colonnes — six rangées pour TMDB (248 px), sept
 * pour la clé VIP à cause du tiret (284 px). En-tête : 152 px (VIP, sous-titre
 * d'une ligne) à 171 px (TMDB, deux lignes). Colonne de droite : ≈ 306 px.
 * Le pire cas laisse 84 px de marge.
 */
const KEYBOARD = tvKeyboardScopes('cle');
const ACTIONS_SCOPE = 'cle-boutons';
const TMDB_LENGTH = 32;

const COPY: Record<KeyKind, { title: string; subtitle: string; placeholder: string }> = {
  vip: {
    title: 'Clé VIP Movix',
    subtitle: 'Donne accès aux sources de lecture résolues par Movix. Elle a la forme VIP-XXXXXXXXXXXX.',
    placeholder: 'VIP-…',
  },
  tmdb: {
    title: 'Clé TMDB',
    subtitle:
      'Sert aux affiches, résumés et rangées. Gratuite : themoviedb.org, Paramètres, API. Saisir la clé « API Key » (32 caractères).',
    placeholder: '32 caractères, lettres a–f et chiffres',
  },
};

/** Remarque sur le format, ou `null` si la saisie a l'air correcte. */
function formatNote(kind: KeyKind, value: string): { tone: 'ok' | 'warn'; text: string } | null {
  if (!value) return null;
  if (kind === 'tmdb') {
    const key = value.toLowerCase();
    if (/[^0-9a-f]/.test(key)) return { tone: 'warn', text: 'Une clé TMDB ne contient que des chiffres et les lettres a à f.' };
    if (key.length < TMDB_LENGTH) return { tone: 'warn', text: `Encore ${TMDB_LENGTH - key.length} caractère${TMDB_LENGTH - key.length > 1 ? 's' : ''}.` };
    if (key.length > TMDB_LENGTH) return { tone: 'warn', text: `${key.length - TMDB_LENGTH} caractère${key.length - TMDB_LENGTH > 1 ? 's' : ''} de trop.` };
    return { tone: 'ok', text: 'Longueur correcte : prête à être vérifiée.' };
  }
  const key = value.toUpperCase();
  if (!'VIP-'.startsWith(key.slice(0, 4)) || (key.length >= 4 && !key.startsWith('VIP-'))) {
    return { tone: 'warn', text: 'Une clé VIP commence par « VIP- ».' };
  }
  return null;
}

const STATUS_STYLE: Record<'info' | 'ok' | 'error', { box: string; icon: TvIconName }> = {
  info: { box: 'border-white/15 bg-white/[0.06] text-white/80', icon: 'info' },
  ok: { box: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200', icon: 'check' },
  error: { box: 'border-red-400/30 bg-red-400/10 text-red-200', icon: 'alert' },
};

const TvKeyEntry: React.FC = () => {
  const { kind: rawKind } = useParams<{ kind: string }>();
  const kind: KeyKind = rawKind === 'tmdb' ? 'tmdb' : 'vip';
  const copy = COPY[kind];

  const [value, setValue] = useState('');
  const [status, setStatus] = useState<{ tone: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = kind === 'vip' ? getAccessKey() : getStoredTmdbKey();

  useInitialFocus(KEYBOARD.grid);

  const append = useCallback((character: string) => setValue(previous => (previous + character).slice(0, 64)), []);
  const backspace = useCallback(() => setValue(previous => previous.slice(0, -1)), []);
  const clear = useCallback(() => setValue(''), []);

  const save = async () => {
    const key = kind === 'tmdb' ? value.trim().toLowerCase() : value.trim().toUpperCase();
    if (!key) {
      setStatus({ tone: 'error', text: 'Saisissez d’abord une clé.' });
      return;
    }
    setBusy(true);
    setStatus({ tone: 'info', text: 'Vérification…' });
    if (kind === 'vip') {
      const previous = getAccessKey();
      localStorage.setItem('access_code', key);
      const valid = await checkVipStatus(true);
      if (valid) {
        setStatus({ tone: 'ok', text: 'Clé VIP acceptée par Movix.' });
        setValue('');
      } else {
        // `checkVipStatus` a retiré la clé refusée ; on remet la précédente.
        if (previous) {
          localStorage.setItem('access_code', previous);
          void checkVipStatus(true);
        }
        setStatus({ tone: 'error', text: 'Clé refusée par Movix. Vérifiez la saisie.' });
      }
      setBusy(false);
      return;
    }
    const valid = await validateTmdbKey(key);
    if (!valid) {
      setStatus({ tone: 'error', text: 'Clé refusée par TMDB. Vérifiez la saisie.' });
      setBusy(false);
      return;
    }
    setStoredTmdbKey(key);
    setStatus({ tone: 'ok', text: 'Clé acceptée. Rechargement de l’interface…' });
    // Les modules lisent la clé à leur chargement : voir `config/tmdbKey.ts`.
    window.setTimeout(() => window.location.reload(), 1200);
  };

  const remove = () => {
    if (kind === 'vip') {
      revokeVipStatus();
      setStatus({ tone: 'info', text: 'Clé VIP supprimée.' });
    } else {
      setStoredTmdbKey(null);
      setStatus({ tone: 'info', text: 'Clé supprimée. Rechargement…' });
      window.setTimeout(() => window.location.reload(), 1200);
    }
  };

  const actions: { label: string; hint: string; icon: TvIconName; onSelect: () => void }[] = [
    {
      label: busy ? 'Vérification…' : 'Enregistrer',
      hint: 'Vérifier puis garder cette clé',
      icon: 'check',
      onSelect: () => {
        if (!busy) void save();
      },
    },
    {
      label: 'Supprimer la clé',
      hint: current ? `Retire ${maskKey(current)}` : 'Aucune clé enregistrée',
      icon: 'trash',
      onSelect: remove,
    },
  ];

  const display = kind === 'tmdb' ? value.toLowerCase() : value.toUpperCase();
  const note = formatNote(kind, value);
  const statusStyle = status ? STATUS_STYLE[status.tone] : null;

  return (
    <TvSubpage
      title={copy.title}
      subtitle={copy.subtitle}
      downScope={KEYBOARD.actions}
      aside={
        <span className="flex items-center gap-2 text-[13px] text-white/55">
          <TvStatusDot tone={current ? 'ok' : 'off'} />
          {current ? <span className="font-mono tracking-wider">{maskKey(current)}</span> : 'Aucune clé enregistrée'}
        </span>
      }>
      <div className="flex gap-10">
        <div className="shrink-0" style={{ width: TV_KEYBOARD_WIDTH }}>
          <TvKeyboard
            idPrefix="cle"
            rightNeighbor={ACTIONS_SCOPE}
            downNeighbor={null}
            extraKeys={kind === 'vip' ? ['-'] : undefined}
            hideSpace
            onAppend={append}
            onBackspace={backspace}
            onClear={clear}
          />
        </div>
        {/* Colonne bornée : le clavier ne fait que 220 px, sans limite elle
            s'étirerait sur 600 et le champ dépasserait de loin les boutons. */}
        <div className="min-w-0 max-w-[440px] flex-1">
          <div
            className={
              'flex h-12 items-center rounded-xl border-2 bg-white/[0.06] px-4 ' +
              (note?.tone === 'warn' ? 'border-amber-400/50' : value ? 'border-movix-red/60' : 'border-white/15')
            }>
            {value ? (
              <span className="truncate font-mono text-[18px] tracking-wider">{display}</span>
            ) : (
              <span className="truncate text-[15px] text-white/30">{copy.placeholder}</span>
            )}
            {/* Curseur : la saisie se fait au clavier virtuel, toujours en fin de champ. */}
            <span className="ml-0.5 h-6 w-[2px] shrink-0 rounded-full bg-movix-red-bright" aria-hidden />
          </div>

          {kind === 'tmdb' ? (
            <div className="mt-2.5 flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <span
                  className={'block h-full rounded-full ' + (value.length > TMDB_LENGTH ? 'bg-amber-400' : 'bg-movix-red')}
                  style={{ width: `${Math.min(100, (value.length / TMDB_LENGTH) * 100)}%` }}
                />
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-white/50">
                {value.length} / {TMDB_LENGTH}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-[13px] tabular-nums text-white/45">
              {value.length} caractère{value.length > 1 ? 's' : ''}
            </p>
          )}
          <p className={'mt-1.5 min-h-[18px] text-[13px] ' + (note?.tone === 'warn' ? 'text-amber-300' : 'text-emerald-300')}>
            {note?.text ?? ''}
          </p>

          <KeyActions actions={actions} />

          {status && statusStyle && (
            <p className={'mt-4 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[14px] ' + statusStyle.box} role="status">
              <TvIcon name={statusStyle.icon} size={18} className="shrink-0" />
              {status.text}
            </p>
          )}
        </div>
      </div>
    </TvSubpage>
  );
};

const KeyActions: React.FC<{ actions: { label: string; hint: string; icon: TvIconName; onSelect: () => void }[] }> = ({ actions }) => {
  const scopeRef = useFocusScope({
    id: ACTIONS_SCOPE,
    orientation: 'column',
    count: actions.length,
    // Haut : le bouton Retour. Non déclaré, le moteur suivrait l'ordre du DOM
    // et tomberait dans la grille de lettres, de l'autre côté de l'écran.
    neighbors: { up: BACK_SCOPE, left: KEYBOARD.grid, down: null },
  });
  return (
    <div ref={scopeRef} className="mt-4 flex w-full flex-col gap-2">
      {actions.map((action, index) => (
        <TvChoice
          key={index}
          scopeId={ACTIONS_SCOPE}
          index={index}
          icon={action.icon}
          label={action.label}
          hint={action.hint}
          onSelect={action.onSelect}
        />
      ))}
    </div>
  );
};

export default TvKeyEntry;
