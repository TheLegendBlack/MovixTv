import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n' // Initialize i18n before App
import App from './App.tsx'
import axios from 'axios'
import { installHttpCache } from './utils/httpCache'
import { installSegmentedSeasons } from './utils/segmentedSeasons'
import { installManualEpisodes } from './utils/manualEpisodes'
import './index.css'
import './styles/light-mode.css'
import { isTvDevice } from './utils/tv/isTvDevice'
import { installEdition } from './tv/edition'
import { initFlexGapSupport } from './utils/flexGapSupport'

// Repli de `gap` sur les conteneurs flex (amont, 10/2026) : détection avant
// React, puis compensation par marges sur les WebView Android qui ne le gèrent
// pas (Chromium < 84). Sans effet sur la TV de référence (WebView 152), où la
// sonde mesure le gap et la fonction s'arrête aussitôt ; utile aux téléviseurs
// plus anciens.
initFlexGapSupport();

// Point d'entrée du site téléviseur.
//
// Réduit le 15/09/2026 à ce que la TV utilise : l'analytique, la détection de
// blocage FAI (redirection vers un miroir), le service worker et les
// notifications push étaient des mécanismes du site web, sans objet dans la
// WebView du shell Android. Voir `.tv-backup/suppression-2026-09-15-passe2/`.

// Marqueur d'interface téléviseur sur <html>.
//
// Le shell natif le pose déjà via tv-shim.ts, mais pas le navigateur en mode
// `?tv=1` : sans lui, les surcharges CSS destinées à la TV ne s'appliqueraient
// pas pendant le développement, et l'écran de test différerait de l'écran réel.
if (isTvDevice()) {
  document.documentElement.classList.add('movix-tv');
}

// Ce qui dépend de l'édition, posé avant le premier rendu (un thème en cache,
// par exemple, pour éviter un éclair des couleurs par défaut). Voir
// `tv/edition.tsx`.
installEdition();

// Amorçage de la clé VIP en développement.
//
// La clé vit dans localStorage, pas dans la configuration : elle se saisit
// normalement dans le formulaire de code d'accès du site. Sur téléviseur, la
// taper à la télécommande est impraticable tant qu'il n'y a pas de clavier à
// l'écran — et le stockage de la WebView est distinct de celui du navigateur du
// poste de dev, donc la saisir sur l'ordinateur ne la transmet pas.
//
// `import.meta.env.DEV` vaut false dans un build de production : Vite élimine
// ce bloc entièrement, la clé n'est jamais embarquée dans le bundle publié.
// Une valeur déjà présente n'est jamais écrasée.
if (import.meta.env.DEV) {
  const devAccessCode = import.meta.env.VITE_DEV_ACCESS_CODE;
  if (devAccessCode && !localStorage.getItem('access_code')) {
    localStorage.setItem('access_code', devAccessCode);
  }

  // `is_vip` s'amorce avec la clé, et pas seulement après le contrôle serveur.
  //
  // `isUserVip()` lit cette entrée de façon synchrone et ne l'amorce jamais :
  // elle n'est écrite qu'au retour de `checkVipStatus()`, un aller-retour
  // réseau. Or une dizaine d'extracteurs abandonnent immédiatement quand elle
  // est absente, et l'origine `localhost:3000` du téléviseur a son propre
  // stockage, froid à chaque purge.
  //
  // Optimiste et non autoritaire : `checkVipStatus()` part au montage de
  // `ProfileContext` et appelle `revokeVipStatus()` — qui retire cette même
  // entrée — si le serveur refuse la clé.
  if (devAccessCode && !localStorage.getItem('is_vip')) {
    localStorage.setItem('is_vip', 'true');
  }
}

const safeLocalStorageGetItem = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

// Coins carrés (Paramètres > Apparence) : posé avant le premier render pour
// éviter un flash de coins arrondis. Togglé live depuis SettingsPage.
if (safeLocalStorageGetItem('square_corners_enabled') === '1') {
  document.documentElement.classList.add('square-corners');
}

// Cache des lectures de catalogue (TMDB, /api/content) : une réponse déjà vue
// est resservie sans réseau, et rafraîchie en arrière-plan si elle a vieilli.
// Voir `utils/httpCache.ts` pour ce qui est mis en cache — et surtout pour ce
// qui ne l'est jamais.
installHttpCache(axios)

// Séries que TMDB découpe en segments de 11 minutes (« Bienvenue chez les
// Loud ») : les épisodes sont recollés à la volée pour coller aux fichiers.
// Posé APRÈS le cache — celui-ci stocke la réponse TMDB brute, la fusion
// s'applique à chaque lecture. Voir `utils/segmentedSeasons.ts`.
installSegmentedSeasons(axios)

// Compléments locaux aux épisodes absents de TMDB (amont, 10/2026), communs
// aux fiches et aux lecteurs.
installManualEpisodes(axios)

// Garde contre le plantage React + traduction navigateur (Google Translate,
// Edge, Samsung Internet, …) : le moteur de traduction remplace des nœuds texte
// sous React, dont le réconciliateur appelle ensuite removeChild / insertBefore
// sur un nœud dont le parent a changé → « Failed to execute 'removeChild' on
// 'Node' ». Rendre ces opérations inertes quand le parent ne correspond plus
// laisse React se rétablir au lieu de démonter tout l'arbre.
// https://github.com/facebook/react/issues/11538#issuecomment-417504600
if (typeof Node === 'function' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

// Montage robuste (amont, 10/2026) : recrée le conteneur s'il manque (React
// refuse de monter sur null, erreur #299) et attend le DOM s'il n'est pas prêt.
const mountApp = () => {
  let container = document.getElementById('root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
  }

  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp, { once: true });
} else {
  mountApp();
}
