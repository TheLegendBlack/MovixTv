import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TvStatusDot, TvSubpage, useInitialFocus } from './kit';
import { TvLinkPanel, type TvLinkAction } from './TvLinkPanel';
import { useLinkFlow, type LinkTicket } from '../useLinkFlow';
import { MovixLinkError, pollMovixLink, startMovixLink, usableVipKey, type MovixLinkVip } from '../movixLink';
import { checkVipStatus, getAccessKey } from '@/utils/vipUtils';

/**
 * Se connecter avec son compte Movix (26/10/2026) : la télé affiche un code et
 * son QR, l'utilisateur le confirme sur le site Movix, la clé VIP de son
 * profil arrive seule. La saisie au clavier virtuel reste possible.
 */

export const MOVIX_LINK_SCOPE = 'movix-boutons';

const ERRORS: Record<string, string> = {
  injoignable: 'Movix est injoignable. Vérifiez la connexion du téléviseur.',
  trop_de_demandes: 'Trop de demandes. Patientez quelques minutes.',
  service_unavailable: 'La connexion Movix est momentanément indisponible.',
  origine_refusee: 'Movix n’accepte pas encore la connexion depuis cette adresse.',
};

const errorText = (error: unknown) =>
  error instanceof MovixLinkError ? ERRORS[error.code] ?? `Échec (${error.code}).` : 'Échec inattendu.';

/** Adresse sans le protocole, pour la taper à la main. */
export const manualUrlOf = (verificationUrl: string) => {
  try {
    const url = new URL(verificationUrl);
    return url.host + url.pathname;
  } catch {
    return verificationUrl;
  }
};

/** Garde la clé VIP du compte Movix si Movix la reconnaît ; rend un message sinon. */
export async function adoptMovixVip(vip: MovixLinkVip | null): Promise<true | string> {
  const key = usableVipKey(vip);
  if (!key) return 'Connecté, mais ce profil Movix n’a pas de VIP actif.';
  const previous = getAccessKey();
  // Gardée telle que Movix la rend : c'est la clé exacte du compte.
  localStorage.setItem('access_code', key);
  if (await checkVipStatus(true)) return true;
  if (previous) {
    localStorage.setItem('access_code', previous);
    void checkVipStatus(true);
  }
  return 'La clé VIP du compte n’a pas été acceptée. Réessayez plus tard.';
}

async function startMovixTicket(): Promise<LinkTicket> {
  const started = await startMovixLink('Movix TV');
  return {
    secret: started.deviceCode,
    code: started.userCode,
    url: started.verificationUrl,
    manualUrl: manualUrlOf(started.verificationUrl),
    expiresIn: started.expiresIn,
    interval: started.interval,
  };
}

async function pollMovixTicket(secret: string) {
  const result = await pollMovixLink(secret);
  return result.status === 'approved' ? { approved: result.vip } : result.status;
}

/** Code, QR, attente et issue de la connexion Movix ; partagé avec le premier lancement. */
export const MovixLinkPanel: React.FC<{ actions: TvLinkAction[]; onLinked?: () => void }> = ({ actions, onLinked }) => {
  const onApproved = useCallback(
    async (vip: MovixLinkVip | null) => {
      const outcome = await adoptMovixVip(vip);
      if (outcome === true) onLinked?.();
      return outcome;
    },
    [onLinked],
  );
  const { state, restart } = useLinkFlow({ start: startMovixTicket, poll: pollMovixTicket, onApproved, errorText });
  return (
    <TvLinkPanel
      scopeId={MOVIX_LINK_SCOPE}
      state={state}
      restart={restart}
      doneText="Connecté à Movix : clé VIP enregistrée."
      actions={actions}
    />
  );
};

const TvMovixLink: React.FC = () => {
  const navigate = useNavigate();
  useInitialFocus(MOVIX_LINK_SCOPE);
  const current = getAccessKey();
  return (
    <TvSubpage
      title="Se connecter avec Movix"
      subtitle="Confirmez ce code sur le site Movix, connecté à votre compte : la clé VIP de votre profil arrive sur ce téléviseur."
      trail={['Paramètres', 'Clé VIP Movix']}
      downScope={MOVIX_LINK_SCOPE}
      aside={
        <span className="flex items-center gap-2 text-[13px] text-white/55">
          <TvStatusDot tone={current ? 'ok' : 'off'} />
          {current ? 'Clé VIP enregistrée' : 'Aucune clé VIP'}
        </span>
      }>
      <MovixLinkPanel
        actions={[
          {
            label: 'Saisir la clé',
            hint: 'Taper la clé VIP à la télécommande',
            icon: 'key',
            // On n'arrive ici que depuis la saisie de la clé : on y retourne.
            onSelect: () => navigate(-1),
          },
        ]}
      />
    </TvSubpage>
  );
};

export default TvMovixLink;
