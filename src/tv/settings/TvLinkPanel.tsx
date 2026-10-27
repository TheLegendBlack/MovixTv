import React from 'react';
import { BACK_SCOPE, TvChoice, TvIcon, type TvIconName } from './kit';
import { useFocusScope } from '../nav/hooks';
import { TvLinkCode } from '../components/TvLinkCode';
import type { LinkFlowState } from '../useLinkFlow';

/**
 * Écran à code affiché (26/10/2026) : à gauche le code, son QR et l'attente,
 * ou l'issue ; à droite les actions. Commun à la connexion Movix et aux
 * comptes d'édition. « Nouveau code » est toujours la première action.
 *
 * Budget vertical (540 px) : en-tête ≈ 150 px, QR 168 px ; trois tuiles
 * d'actions (≈ 170 px) tiennent dans la colonne de droite.
 */

export interface TvLinkAction {
  label: string;
  hint: string;
  icon: TvIconName;
  onSelect: () => void;
}

/** Étape d'accueil propre à une édition (`EDITION_WELCOME_STEP`), affichée en dernier. */
export interface TvWelcomeLinkStep {
  title: string;
  subtitle: string;
  /** Portée des actions du panneau, pour y poser le focus. */
  scopeId: string;
  Panel: React.FC<{ actions: TvLinkAction[]; onLinked?: () => void }>;
}

export const TvLinkPanel: React.FC<{
  scopeId: string;
  state: LinkFlowState;
  restart: () => void;
  doneText: string;
  actions: TvLinkAction[];
}> = ({ scopeId, state, restart, doneText, actions }) => {
  const allActions = [{ label: 'Nouveau code', hint: 'Afficher un autre code', icon: 'reset' as const, onSelect: restart }, ...actions];

  return (
    <div className="flex gap-10">
      <div className="min-w-0 flex-1">
        {state.phase === 'waiting' ? (
          <TvLinkCode
            code={state.ticket.code}
            url={state.ticket.url}
            manualUrl={state.ticket.manualUrl}
            expiresAt={state.expiresAt}
          />
        ) : (
          <div className="flex h-[168px] items-center">
            <p className="flex items-center gap-2.5 text-[16px] text-white/70" role="status">
              {state.phase === 'done' ? (
                <>
                  <TvIcon name="check" size={22} className="shrink-0 text-emerald-300" />
                  {doneText}
                </>
              ) : state.phase === 'stopped' ? (
                <>
                  <TvIcon name="alert" size={22} className="shrink-0 text-amber-300" />
                  {state.message}
                </>
              ) : (
                <>
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-movix-red-bright" aria-hidden />
                  {state.phase === 'finishing' ? 'Connexion…' : 'Demande d’un code…'}
                </>
              )}
            </p>
          </div>
        )}
      </div>
      <LinkActions scopeId={scopeId} actions={allActions} />
    </div>
  );
};

const LinkActions: React.FC<{ scopeId: string; actions: TvLinkAction[] }> = ({ scopeId, actions }) => {
  const scopeRef = useFocusScope({
    id: scopeId,
    orientation: 'column',
    count: actions.length,
    neighbors: { up: BACK_SCOPE, down: null },
  });
  return (
    <div ref={scopeRef} className="flex w-[320px] shrink-0 flex-col gap-2">
      {actions.map((action, index) => (
        <TvChoice
          key={action.label}
          scopeId={scopeId}
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
