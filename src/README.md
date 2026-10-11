# Site Movix TV (`src/`)

Le site est ce que la WebView du shell Android affiche. Depuis le 15/09/2026 il
est réduit à ce que le téléviseur utilise : l'interface télécommande sous
`/tvapp/*` et les deux pages de lecture. Le site souris d'origine (accueil,
fiches, compte, profils, WatchParty, VIP, Wrapped…) est archivé dans
`.tv-backup/suppression-2026-09-15-passe2/`.

## Démarrage

```bash
cp .env.example .env     # VITE_MAIN_API, VITE_PROXIES_EMBED_API, VITE_SITE_URL, VITE_TMDB_API_KEY, VITE_DEV_ACCESS_CODE
npm install
npm run dev              # http://localhost:3000, que la TV joint via `adb reverse tcp:3000`
```

Sur un navigateur de bureau, l'interface TV s'ouvre avec `http://localhost:3000/tvapp?tv=1`
(le paramètre force la détection téléviseur ; les flèches du clavier jouent le
pavé directionnel, Entrée la touche OK). L'écran de référence est 960 × 540
pixels CSS : réduire la fenêtre à cette taille donne le rendu réel.

```bash
npm run build            # dist/
npm run lint
node --test src/tv/__tests__/*.mjs src/tv/nav/__tests__/*.mjs
```

Le typecheck a une particularité, décrite dans le README principal : passer par
un fichier temporaire qui étend `tsconfig.app.json`.

## Architecture

```text
src/
|-- main.tsx                  # Point d'entrée : i18n, cache HTTP, recollage des saisons segmentées, clé VIP en dev
|-- App.tsx                   # Racine : vérification VIP, langue, gestionnaire de 401, fournisseurs, 4 routes
|-- routing/registry.tsx      # /tvapp/*, /tvapp/diag, /watch/movie/:tmdbid, /watch/tv/:tmdbid/s/:season/e/:episode
|-- tv/                       # Interface téléviseur
|   |-- TvApp.tsx, TvLayout.tsx        # Routes internes, coquille (échelle, verrou de défilement, Retour)
|   |-- TvBrowse.tsx                   # Accueil, Films, Séries, Animés : bannière + rangées
|   |-- TvCollection.tsx               # « Voir plus » : grille + bandeau de prévisualisation
|   |-- TvDetails.tsx, TvSearch.tsx, TvSettings.tsx, TvDiagnosticsPage.tsx
|   |-- tvScale.ts                     # Échelle de viewport (gabarit 960 × 540)
|   |-- edition.tsx                    # Ce qui dépend de l'édition : démarrage, rangées, routes, lignes de Paramètres
|   |-- settings/                      # Réglages : kit, saisie des clés VIP et TMDB
|   |-- devicePerformance.ts           # Palier de performance mesuré, lu par le mode léger
|   |-- components/                    # TvTopNav, TvRow, TvCard, TvMoreCard, TvKeyboard, TvPreviewBanner
|   |-- data/                          # tmdb.ts (registre des rangées), fiches, progression, liste
|   |-- nav/                           # Moteur de focus : TvFocusProvider, resolveMove, hooks, focusRestore
|   `-- player/                        # Télécommande du lecteur, contrôles, thème
|-- pages/Watch/              # WatchMovie, WatchTv (partagés avec le site amont)
|-- components/HLSPlayer.tsx  # Lecteur principal (hls.js), très gros : lire par plages
|-- components/player/settings/   # Panneau de réglages TV en arborescence
|-- components/subtitles/     # Style et aperçu des sous-titres
|-- context/                  # LightMode (mode léger), Profile, AdFreePopup
|-- services/, utils/, hooks/ # Extraction, sous-titres, sources, préférences
|-- i18n/locales/             # fr.json, en.json
`-- index.css, styles/        # Tailwind et mode clair
```

## Ce que le site gère

- navigation au pavé directionnel : bannière, rangées virtualisées, collections, fiche, recherche au clavier virtuel, réglages ;
- lecture : sources (registre serveur Movix avec repli sur l'extraction locale), qualité, audio, sous-titres (décalage, taille TV, pistes incrustées avec détection de langue), vitesse, format, reprise, épisode suivant ;
- télécommande : flèches, OK, Retour, touches média ;
- adaptation à l'appareil : échelle de viewport et palier de performance ;
- bascule du bloqueur de publicités natif du shell, depuis `/tvapp/settings` ;
- saisie de la clé VIP et de la clé TMDB au clavier virtuel, dans les réglages.

## Variables d'environnement

- `VITE_MAIN_API` — API Movix
- `VITE_PROXIES_EMBED_API` — proxy d'extraction (exige la clé VIP)
- `VITE_SITE_URL`
- `VITE_TMDB_API_KEY`
- `VITE_DEV_ACCESS_CODE` — clé VIP personnelle, posée dans `localStorage['access_code']` **en développement seulement** (`import.meta.env.DEV`) ; un build de production ne l'embarque pas.

Les autres entrées de `.env.example` sont un héritage du site web, sans effet.

## Où intervenir selon le sujet

- Rangées et pages de parcours : `tv/data/tmdb.ts` (registre `ROWS`, listes `TV_*_ROWS`), `tv/TvBrowse.tsx`
- Focus et télécommande dans l'interface : `tv/nav/`
- Télécommande dans le lecteur : `tv/player/useTvPlayerRemote.ts`
- Panneau de réglages du lecteur : `components/player/settings/`
- Sous-titres : `components/HLSPlayer.tsx` (pistes, cues), `components/subtitles/`, `utils/captionLanguageSniff.ts`
- Extraction : `utils/extractM3u8.ts`, `utils/hosterRegistry.ts`, `services/`
- Traductions : `i18n/locales/`

## Notes de contribution

- Les imports inutilisés cassent le lint ; le lecteur porte des erreurs de lint et de type héritées, à comparer avant/après plutôt qu'à viser zéro.
- `fr.json` et `en.json` restent alignés ; ne jamais les réécrire avec un sérialiseur JSON.
- Les fichiers de `tv/` fournis par l'auteur amont arrivent souvent en remplacement complet : vérifier par `diff` que les ajouts locaux survivent.
- Toute vérification se termine sur la TV, pas seulement dans le navigateur.
