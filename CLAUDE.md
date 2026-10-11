# CLAUDE.md - Movix TV

## Ce qu'est ce dépôt

Ce clone de Movix est dédié **à 100 % à une application Android TV**. Il ne
sert plus le site web, aucun backend n'y est hébergé, rien n'est déployé sur
movix.fun ou movix.men. Il contient deux choses :

1. **`src/`** — le site React/Vite réduit à l'interface téléviseur (`/tvapp/*`)
   et au lecteur vidéo (`/watch/movie/…`, `/watch/tv/…`), pilotés à la
   télécommande.
2. **`app/`** — le shell React Native 0.75 (Android) qui affiche ce site dans
   une WebView, avec ses modules natifs : proxy média, bloqueur de publicités,
   relais télécommande, mise à jour d'APK, DNS, keep-awake, PiP.

L'API distante (`VITE_MAIN_API`, `proxiesembed.movix.men`) reste en ligne et
n'est pas dans ce dépôt. L'accès VIP se fait par la clé `x-access-key`, lue
depuis `localStorage['access_code']`.

Le nettoyage des 15/09/2026 a retiré le site souris, les backends, les
extensions, iOS et Chromecast. Tout est **déplacé, pas effacé**, dans
`.tv-backup/suppression-2026-09-15*/` (un README par dossier explique comment
restaurer). Le dossier `.tv-backup/` n'est référencé par aucun code.

## Cible matérielle

En l'état, le projet a été **optimisé pour un téléviseur de référence** :
Edenwood 4K, Android 11 (API 30), WebView Chromium 152, viewport CSS 960×540
(écran 1920×1080 à densité 2), pas de Widevine, SoC lent. C'est cette échelle
qui a fixé les dimensions en pixels de l'interface (marges, cartes, clavier,
tailles d'images TMDB) et le budget d'animation : `opacity` et `transform`
seulement, jamais la mise en page.

Ce n'est pas une limite : le code est du web standard et s'adapte à tout
autre téléviseur Android par deux mécanismes automatiques (15/09/2026) :

- **Échelle de viewport** (`src/tv/tvScale.ts`, appliquée par `TvLayout`) :
  sur un viewport autre que 960 × 540, l'interface est dessinée dans une boîte
  au gabarit puis mise à l'échelle par `transform: scale()`. Les pages lisent
  leur hauteur dans `--tv-screen-height` ; `TvRow` mesure sa fenêtre en
  `offsetWidth` quand l'échelle est active. Sur le gabarit natif, **rien n'est
  appliqué**. Essai sur la référence : `?tvscale=0.8`. Le lecteur `/watch`
  n'est pas concerné, il est fluide.
- **Palier de performance** (`src/tv/devicePerformance.ts`) : pire seconde
  d'images par seconde des six premières secondes de l'accueil, mémorisée une
  semaine (`movix:tv:perf`). Sous 30, le mode léger du site (transitions
  coupées) s'active au lancement suivant. La référence mesure 57 et sort
  « reference » ; son mode léger est déjà actif par sa mémoire annoncée (1 Go).

`/tvapp/settings` affiche le viewport, l'échelle et le palier mesuré ;
`/tvapp/diag` mesure en direct. Mesurer sur la TV avant de conclure — voir
`app/README.md` et les scripts.

## Choix du modèle pour les sous-agents

Ne pas envoyer Opus sur tout. Haiku pour les tâches mécaniques (renommage,
clé i18n, une règle CSS), Sonnet pour le développement courant (fonction avec
un modèle existant, exploration, correction), Opus seulement pour les
décisions d'architecture et les bogues multi-couches. En cas de doute, Sonnet.

## Commandes

```bash
# Racine (site)
npm run dev            # Vite sur http://localhost:3000 (la TV le joint via adb reverse)
npm run build          # Build de production -> dist/
npm run lint           # ESLint
npm run tv             # scripts/tv-dev-up.sh : Vite + Metro + ponts adb, maintenus en vie
npm run app:publish    # scripts/publish-app.mjs : publie l'APK release et app/version.json
node --test src/tv/__tests__/*.mjs src/tv/nav/__tests__/*.mjs   # tests du site TV
# Typecheck du site : ATTENTION, `tsc -p tsconfig.json` ne vérifie RIEN (fichier
# « solution », files: []). tsconfig.app.json porte `ignoreDeprecations: "6.0"`
# que TypeScript 5.9 refuse ; passer par un fichier temporaire qui l'étend :
echo '{ "extends": "./tsconfig.app.json", "compilerOptions": { "ignoreDeprecations": "5.0" } }' > tsconfig.check.json \
  && npx tsc --noEmit -p tsconfig.check.json; rm -f tsconfig.check.json
# Le dépôt amont laisse des erreurs de type dans HLSPlayer*.tsx, WatchMovie,
# WatchTv, sous-titres : 64 au 11/10/2026, une cinquantaine quand `@types/node`
# est installé (il résout le namespace NodeJS). Comparer avant/après.

# app/ (shell)
npm start                        # Metro (port 8081)
npm run android                  # build debug + installation
npm run build:userscript         # régénère src/injection/userscript-source.ts
node --test tests/*.mjs          # tests du shell
cd android && ./gradlew assembleDebug        # APK debug (JDK 21 requis, voir plus bas)
cd android && ./gradlew testDebugUnitTest    # tests Kotlin
```

Ne jamais lancer Metro depuis une session d'assistant : l'utilisateur le tient
dans son propre terminal. Gradle exige le JDK 21, réglé dans
`~/.gradle/gradle.properties` (`org.gradle.java.home`). Ne pas masquer le code
de sortie d'un build par un `| tail`.

## Structure

```
src/
  main.tsx, App.tsx          # entrée et racine réduites à la TV (VIP, langue, 401, 4 routes)
  routing/registry.tsx       # les 4 routes : /tvapp/*, /tvapp/diag, /watch/movie, /watch/tv
  tv/                        # l'interface téléviseur
    TvApp.tsx, TvLayout.tsx  # routes internes, coquille (barre, verrou de défilement, Retour)
    TvBrowse.tsx             # accueil / Films / Séries / Animés (bannière + rangées)
    TvCollection.tsx         # page « Voir plus » (grille + bandeau de prévisualisation)
    TvDetails.tsx, TvSearch.tsx, TvSettings.tsx, TvDiagnosticsPage.tsx
    tvScale.ts               # échelle de viewport (boîte 960×540 mise à l'échelle hors gabarit natif)
    edition.tsx              # ce qui dépend de l'édition : démarrage, rangées des pages, routes et lignes de Paramètres
    settings/                # écrans de réglages : kit, saisie des clés VIP et TMDB
    devicePerformance.ts     # palier de performance mesuré, lu par le mode léger
    components/              # TvTopNav, TvRow, TvCard, TvMoreCard, TvKeyboard, TvPreviewBanner
    data/tmdb.ts             # registre des rangées (ROWS) et listes par page (TV_*_ROWS)
    data/pages.ts            # les quatre pages, leurs rangées par défaut et leur bannière
    nav/                     # moteur de focus : TvFocusProvider, resolveMove, hooks, focusRestore
    player/                  # useTvPlayerRemote (télécommande), contrôles, thème
  pages/Watch/               # WatchMovie, WatchTv (partagés avec le site amont)
  components/HLSPlayer.tsx   # lecteur principal (très gros fichier : lire par plages)
  components/player/settings # panneau de réglages TV (drill-down) et ses sections
  utils/, services/, hooks/, context/, i18n/, types/
app/
  src/screens/BrowserScreen.tsx      # la WebView plein cadre + écran d'erreur miroirs
  src/components/WebViewBrowser.tsx  # WebView, injection, bloqueur, télécommande
  src/services/bridge.ts             # pont page <-> natif (proxy média, PiP, Retour, bloqueur)
  src/injection/                     # scripts injectés : tv-shim, bridge-runtime, userscript-source (GÉNÉRÉ)
  android/app/src/main/java/com/movix/app/
    adblock/  proxy/  device/  update/  dns/  pip/  playback/
  patches/react-native-webview+13.16.1.patch   # hook requestInterceptor du bloqueur + isTopFrame
userscript/movix.user.js     # SOURCE des extracteurs ; éditer ici puis `npm run build:userscript`
scripts/                     # tv-dev-up.sh, tv-dev.sh, publish-app.mjs
public/movix.png             # seul asset public restant (sonde DNS du lecteur)
```

## Conventions

- Composants en PascalCase, hooks préfixés `use`, utilitaires en camelCase,
  constantes en SCREAMING_SNAKE_CASE ; alias `@/` vers `src/`.
- Tailwind uniquement (pas de CSS-in-JS), état par React Context.
- Français d'abord : interface, commentaires, `fr.json` puis `en.json` — les
  deux fichiers de langue doivent rester alignés. Ne jamais les réécrire avec
  un sérialiseur JSON (ça change des centaines de lignes d'échappement) :
  insérer les clés textuellement.
- TypeScript strict. Le lint du dépôt amont a des erreurs préexistantes dans
  `HLSPlayer.tsx` : comparer les comptes avant/après plutôt que viser zéro.
- Les commentaires expliquent le **pourquoi** et citent la mesure qui a
  motivé le choix (date, appareil).

## Règles de travail

- **Rien ne s'efface** : avant toute suppression ou refonte, copier dans
  `.tv-backup/<libellé>/` en conservant les chemins. Le tri de `.tv-backup/`
  est une décision de l'utilisateur.
- **Patchs amont** : quand l'utilisateur fournit des fichiers venant de
  l'auteur du site (`~/Downloads/Modif Movix Tv/`), appliquer le `.patch` avec
  `git apply` plutôt que d'écraser des fichiers complets qui datent d'avant
  nos ajouts locaux ; vérifier par `diff` que rien de local ne disparaît.
- **Reprise du dépôt amont** (https://github.com/movixstream/MovixOpenSource,
  nouvelle adresse depuis 10/2026) : fusion à trois voies fichier par fichier
  (`git merge-file`), base = dernier commit amont déjà intégré, jamais une
  copie brute. Dernier commit intégré : **`0e7cd86`** (08/10/2026), le
  11/10/2026 ; sauvegarde d'avant fusion dans `.tv-backup/avant-maj-amont-2026-10/`.
  Gardés volontairement à notre version : `vite.config.ts` (service worker,
  bundle legacy, Sentry du site web), `ErrorBoundary.tsx` (la version amont
  tire `@sentry/react`, trop lourd pour le SoC), `AdFreePlayerAds.tsx` (jamais
  affiché sur TV), `TurnstileWidget.tsx`. Les fichiers ajoutés par l'amont ne
  sont repris que s'ils sont importés (vérifier aussi `app/android/**`, où un
  nouveau `.kt` manquant ne se voit qu'à la compilation Gradle).
- **La clé VIP** vit dans `.env` (`VITE_DEV_ACCESS_CODE`, gitignoré), amorcée
  dans `localStorage` par `main.tsx` en développement seulement.
- **Ce qui exige un nouvel APK** : `app/android/**` (Kotlin, manifeste,
  Gradle). `app/src/**` passe par Metro et `src/**` par Vite, sans rebuild.
- **Mesurer sur la TV** : `adb shell input keyevent` pour les touches,
  `adb exec-out screencap -p` pour prouver un état, `adb logcat -d | grep
  CONSOLE` pour la console du site. Un `keydown` synthétique dispatché sur
  `window` n'atteint que les écouteurs de `window`, jamais le `onKeyDown`
  React d'un bouton. Toute lecture de test réécrit `progress_*` dans
  `localStorage` : noter la valeur avant, la remettre après.
- Ne rien lancer en tâche de fond qui occupe 8081 ou 3000.

## Couleurs, rangées, réglages (10/2026)

- **Couleurs** : jamais de couleur en dur dans `src/tv`. Fond `movix-ink`,
  accent `movix-red` / `movix-red-bright`, pastille de focus `tv-focus` et son
  texte `tv-on-focus` : jetons Tailwind adossés aux variables CSS `--tv-*`
  (triplets RVB, défauts dans `src/index.css`). Dans un style en ligne :
  `rgb(var(--tv-ink) / 0.5)`.
- **Rangées** : les listes `TV_*_ROWS` de `tmdb.ts` sont les valeurs par
  défaut, regroupées par page avec leur bannière dans `data/pages.ts` ; les
  pages les lisent par `usePageRows(page)` (`tv/edition.tsx`).
- **Clés** : clé VIP et clé TMDB saisissables dans Paramètres. La clé TMDB passe
  par `src/config/tmdbKey.ts` (réglages d'abord, `.env` ensuite) ; les modules
  la lisent à leur chargement, l'écran de saisie recharge donc la page.
- Vérifier sans la TV : build puis Chrome sans interface à 960×540, densité 2
  (méthode de comparaison des couleurs calculées avant/après).
- **Page Paramètres** : six lignes au plus dans 540 px (mesuré le 11/10/2026,
  la septième sortait de l'écran). Une nouvelle entrée en remplace une.


## Site servi hors des domaines Movix (11/10/2026)

- **Bloqueur natif** : il juge « tierce » toute requête dont le Referer n'est
  pas un hôte autorisé. Le shell déclare donc les hôtes du site chargé
  (`trustSiteUrls` dans `BrowserScreen`, méthode native synchrone
  `trustSiteHost`) ; sans ça, TMDB recevait un 204 sans en-têtes CORS.
- **API Movix** (`api.movix.men`) : liste d'origines CORS côté serveur Movix.
  `localhost:3000` et `movix.men` y sont, pas une adresse d'hébergement propre
  (préflight 403, mesuré le 11/10/2026) : VIP et sources échouent tant que
  l'auteur de Movix n'a pas ajouté l'adresse. `proxiesembed` accepte `*`.
- Essai d'un site hébergé sur la TV sans APK release : passer `DEV_SITE_URL`
  (`app/src/config/index.ts`) sur son adresse, relancer l'app, puis remettre
  `http://localhost:3000`.

## Variables d'environnement (`.env`, préfixe `VITE_`)

Utilisées : `VITE_MAIN_API`, `VITE_TMDB_API_KEY`, `VITE_PROXIES_EMBED_API`,
`VITE_SITE_URL`, `VITE_DEV_ACCESS_CODE`.

**Jamais `VITE_TMDB_API_KEY` dans un build public** : elle serait lisible dans
le bundle. Les autres entrées du fichier sont héritées du site web et sans
effet ici.

## Portage en APK autonome (étape finale)

Installer l'application compilée sur la TV, sans PC. **Faisable directement
en l'état** : la procédure complète est dans `app/README.md`, section
« Portage en APK autonome ». Les invariants à ne pas oublier en la suivant :

- En release, `DEV_SITE_URL` est ignoré (garde `__DEV__`) et `addressResolver`
  interroge rentry puis `address.json` du projet Movix : remplacer ce chemin par
  une adresse fixe, sinon le shell chargerait movix.men.
- Le pont natif ne fait confiance qu'à une origine `https` : le site doit être
  hébergé en HTTPS avec repli SPA, à une adresse que l'API Movix accepte
  (voir plus haut), et c'est elle qu'on fige dans le shell.
- `src/main.tsx` n'amorce la clé VIP qu'en développement : en production,
  elle se saisit dans Paramètres, Clé VIP Movix (même chose pour la clé TMDB).
- `App.tsx` du shell vérifie `version.json` sur le dépôt GitHub de Movix et
  proposerait l'APK amont : forcer `updateSourceUrl = null` ou publier son
  propre manifeste (`npm run app:publish`).
- Signature : `android/app/keystore.properties` (gitignoré) ; sans lui, la
  release est signée avec la clé de débogage du poste. Changer de signature
  impose une désinstallation, qui efface le stockage de la WebView.
- La chaîne Vite (`index.html`, `vite.config.ts`, Tailwind, `.env`) est
  conservée pour ce build : ne pas la retirer.
