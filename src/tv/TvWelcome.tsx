import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACK_SCOPE, TvChoice, TvSubpage, useInitialFocus } from './settings/kit';
import { useFocusScope } from './nav/hooks';
import { MOVIX_LINK_SCOPE, MovixLinkPanel } from './settings/TvMovixLink';
import { getPreferredVersion, setPreferredVersion, type PreferredVersion } from './preferredVersion';
import { EDITION_WELCOME_STEP } from './edition';

/**
 * Premier lancement (26/10/2026), repris de l'appli TV native de Movix :
 * version préférée, connexion Movix pour la clé VIP, puis l'étape propre à
 * l'édition s'il y en a une. Chaque étape se passe (« Plus tard ») et se
 * retrouve dans Paramètres.
 *
 * Pas d'étape « langue » : les écrans de la télé sont écrits en français,
 * seuls TMDB et le lecteur suivent la langue ; la proposer promettrait une
 * interface anglaise qui n'existe pas.
 *
 * Vu une fois : l'écran se marque vu dès qu'on le quitte, même par Retour.
 * Une télé déjà utilisée (clé VIP, reprise de lecture) ne le voit jamais.
 */

const DONE_KEY = 'movix:tv:welcome';
const VERSION_SCOPE = 'bienvenue-version';

/** Décidé une fois par chargement : la télé ne repasse pas par l'accueil en revenant. */
let shown = false;

/** Vrai pour une installation neuve qui n'a pas encore vu l'accueil. */
export function shouldWelcome(): boolean {
  if (shown) return false;
  try {
    if (localStorage.getItem(DONE_KEY)) return false;
    const used = localStorage.getItem('access_code') !== null
      || Object.keys(localStorage).some(key => key.startsWith('progress_'));
    if (used) localStorage.setItem(DONE_KEY, 'deja-utilisee');
    return !used;
  } catch {
    return false;
  }
}

const markDone = () => {
  try {
    localStorage.setItem(DONE_KEY, String(Date.now()));
  } catch {
    // Sans stockage, l'accueil reviendrait : rien de grave.
  }
};

const VersionStep: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const [current] = useState(getPreferredVersion);
  useInitialFocus(VERSION_SCOPE, current === 'vostfr' ? 1 : 0);
  const choose = (version: PreferredVersion) => {
    setPreferredVersion(version);
    onNext();
  };
  const scopeRef = useFocusScope({
    id: VERSION_SCOPE,
    orientation: 'column',
    count: 2,
    neighbors: { up: BACK_SCOPE, down: null },
  });
  return (
    <div ref={scopeRef} className="flex max-w-[520px] flex-col gap-2">
      <TvChoice
        scopeId={VERSION_SCOPE}
        index={0}
        icon="film"
        label="VF, en français"
        hint="Les sources doublées passent d’abord"
        selected={current === 'vf'}
        onSelect={() => choose('vf')}
      />
      <TvChoice
        scopeId={VERSION_SCOPE}
        index={1}
        icon="film"
        label="VOSTFR, sous-titré"
        hint="La version originale sous-titrée passe d’abord"
        selected={current === 'vostfr'}
        onSelect={() => choose('vostfr')}
      />
    </div>
  );
};

const TvWelcome: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const steps = 2 + (EDITION_WELCOME_STEP ? 1 : 0);

  useEffect(() => {
    shown = true;
    return markDone;
  }, []);

  const finish = useCallback(() => navigate('/tvapp', { replace: true }), [navigate]);
  const next = useCallback(() => {
    if (step + 1 >= steps) finish();
    else setStep(step + 1);
  }, [finish, step, steps]);
  const later = { label: 'Plus tard', hint: 'Passer cette étape', icon: 'chevron' as const, onSelect: next };
  const trail = ['Bienvenue', `Étape ${step + 1} sur ${steps}`];

  if (step === 0) {
    return (
      <TvSubpage
        title="Quelle version préférez-vous ?"
        subtitle="Le lecteur choisit d’abord les sources dans cette langue. Vous pourrez toujours changer de source pendant la lecture."
        trail={trail}
        downScope={VERSION_SCOPE}>
        <VersionStep onNext={next} />
      </TvSubpage>
    );
  }
  if (step === 1) {
    return (
      <WelcomeLinkStep key="movix" scopeId={MOVIX_LINK_SCOPE}>
        <TvSubpage
          title="Votre clé VIP Movix"
          subtitle="Avec un compte Movix VIP, confirmez ce code sur le site Movix : la clé arrive sur ce téléviseur. Sans VIP, passez cette étape."
          trail={trail}
          downScope={MOVIX_LINK_SCOPE}>
          <MovixLinkPanel actions={[later]} onLinked={() => window.setTimeout(next, 1500)} />
        </TvSubpage>
      </WelcomeLinkStep>
    );
  }
  const { title, subtitle, scopeId, Panel } = EDITION_WELCOME_STEP!;
  return (
    <WelcomeLinkStep key="edition" scopeId={scopeId}>
      <TvSubpage title={title} subtitle={subtitle} trail={trail} downScope={scopeId}>
        <Panel actions={[{ ...later, label: 'Terminer', hint: 'Commencer à regarder' }]} onLinked={() => window.setTimeout(finish, 1500)} />
      </TvSubpage>
    </WelcomeLinkStep>
  );
};

/** Pose le focus sur les actions d'une étape à code (une étape, un montage). */
const WelcomeLinkStep: React.FC<{ scopeId: string; children: React.ReactNode }> = ({ scopeId, children }) => {
  useInitialFocus(scopeId);
  return <>{children}</>;
};

export default TvWelcome;
