<p align="center">
  <img src="./public/movix.png" alt="Movix" width="120" />
</p>

<h1 align="center">Movix TV</h1>

<p align="center">
  <strong>MovixTv pour téléviseur Android, à la télécommande — une déclinaison du site de streaming open source Movix.</strong>
</p>

<p align="center">
  <a href="https://react.dev">
    <img alt="React" src="https://img.shields.io/badge/React-149ECA?style=flat-square&logo=react&logoColor=white" />
  </a>
  <a href="https://vite.dev">
    <img alt="Vite" src="https://img.shields.io/badge/Vite-7C3AED?style=flat-square&logo=vite&logoColor=white" />
  </a>
  <a href="https://www.typescriptlang.org">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  </a>
  <a href="https://reactnative.dev">
    <img alt="React Native" src="https://img.shields.io/badge/React_Native-20232A?style=flat-square&logo=react&logoColor=61DAFB" />
  </a>
  <a href="https://kotlinlang.org">
    <img alt="Kotlin" src="https://img.shields.io/badge/Kotlin-7F52FF?style=flat-square&logo=kotlin&logoColor=white" />
  </a>
  <a href="https://www.android.com/tv/">
    <img alt="Android TV" src="https://img.shields.io/badge/Android_TV-3DDC84?style=flat-square&logo=android&logoColor=white" />
  </a>
</p>

<p align="center">
  <strong>Licence :</strong> Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) · <a href="./LICENSE">LICENSE</a>
</p>

Movix TV est une application **Android TV pilotée à la télécommande**. Ce dépôt est un clone de [Movix](https://github.com/movixstream/MovixOpenSource) réduit à cet usage. Il contient deux choses :

- **le site** (`src/`) : l'interface téléviseur et le lecteur vidéo, en React ;
- **le shell** (`app/`) : l'application Android qui affiche ce site dans une WebView, avec ses modules natifs.

Les services distants de Movix (API, extraction des hébergeurs) sont utilisés tels quels, avec une clé d'accès VIP. Le site web souris, les backends, les extensions, la WatchParty, iOS et Chromecast ne font plus partie du dépôt.

## Sommaire

1. [Ce que fait l'application](#ce-que-fait-lapplication)
2. [Comment ça marche](#comment-ça-marche)
3. [Installation pas à pas](#installation-pas-à-pas)
4. [Développer au quotidien](#développer-au-quotidien)
5. [Dépannage](#dépannage)
6. [Vérifier son travail](#vérifier-son-travail)
7. [Adaptation à d'autres téléviseurs](#adaptation-à-dautres-téléviseurs)
8. [Portage en APK autonome](#portage-en-apk-autonome)
9. [Structure du dépôt](#structure-du-dépôt)

## Ce que fait l'application

- **Une interface pensée pour trois mètres** : bannière, rangées d'affiches, pages Films, Séries et Animés, collections « Voir plus », fiche de détail, recherche au clavier virtuel, réglages. Tout se pilote au pavé directionnel.
- **Le lecteur Movix, adapté à la télécommande** : barre de lecture, panneau de réglages en arborescence (sources, qualité, audio, sous-titres, vitesse, format), touches Lecture/Pause, avance et retour rapides, sauts de 10 s aux flèches, reprise de lecture, épisode suivant, noir et blanc à la pause (désactivable).
- **Sous-titres** : décalage temporel, taille automatique pour la TV, pistes incrustées CEA-608 listées et activables, avec détection automatique de leur langue.
- **Récupération des médias** : registre serveur Movix, avec repli sur l'extraction locale embarquée (userscript) quand le serveur n'a pas de résultat.
- **Bloqueur de publicités natif** dans la WebView, débrayable depuis les réglages de l'interface TV.
- **Clés saisies à la télécommande** : la clé VIP Movix et la clé TMDB se renseignent dans les réglages, au clavier virtuel.
- **Shell Android** : proxy média natif (contournement CORS, en-têtes exigés par certains hébergeurs), mise à jour d'APK intégrée, DNS Cloudflare optionnel, écran maintenu allumé pendant la lecture, image dans l'image.

## Comment ça marche

En développement, la TV n'embarque pas le site : elle le charge depuis le poste de travail. Deux serveurs tournent sur le poste, et deux ponts `adb reverse` font croire à la TV que ces ports sont chez elle.

```
        POSTE DE TRAVAIL                              TÉLÉVISEUR
  ┌──────────────────────────┐                 ┌──────────────────────────┐
  │ Vite   :3000  (src/)     │◄── adb reverse ─┤ WebView → localhost:3000 │
  │ Metro  :8081  (app/src/) │◄── adb reverse ─┤ Shell   → localhost:8081 │
  └──────────────────────────┘                 └────────────┬─────────────┘
                                                            │ https
                                                            ▼
                                          API Movix distante (clé VIP)
```

| Serveur | Port | Sert | Lancé par |
|---|---|---|---|
| Vite | 3000 | le site (`src/`) affiché dans la WebView | `npm run dev` à la racine |
| Metro | 8081 | le code JavaScript du shell (`app/src/`) | `npm start` dans `app/` |

La commande `npm run tv` lance les deux, pose les ponts et les surveille. C'est elle qu'on utilise au quotidien.

En production, il n'y a plus ni Vite, ni Metro, ni ponts : le shell charge une adresse HTTPS fixe. Voir [Portage en APK autonome](#portage-en-apk-autonome).

## Installation pas à pas

### Prérequis

- **Node.js 20** ou plus, avec npm.
- **Android SDK**, le plus simple étant d'installer [Android Studio](https://developer.android.com/studio). Dans son *SDK Manager*, cocher :
  - Android SDK Platform **35** ;
  - Android SDK Build-Tools **35.0.0** ;
  - NDK **26.1.10909125** (onglet *SDK Tools*, case *Show Package Details*) ;
  - Android SDK Platform-Tools, qui fournit `adb`. Ajouter son dossier au `PATH`.
- **JDK 21** pour Gradle, déclaré dans `~/.gradle/gradle.properties` :
  ```properties
  org.gradle.java.home=/chemin/vers/jdk-21
  ```
- **Un téléviseur ou une box Android TV** sur le même réseau que le poste.
- **Une clé API TMDB** (gratuite, sur themoviedb.org) et **une clé d'accès VIP Movix**. Ce dépôt n'en fournit aucune : sans clé VIP, l'API distante refuse les requêtes.

Le projet est développé sous macOS. Sous Linux tout fonctionne à l'identique. Sous Windows, `npm run tv` et `scripts/tv-dev.sh` sont des scripts bash : passer par WSL, ou utiliser [la méthode manuelle](#la-méthode-manuelle) qui ne dépend d'aucun script.

### 1. Cloner et installer

```bash
git clone https://github.com/TheLegendBlack/MovixTv.git
cd MovixTv
npm install                          # dépendances du site
cd app
npm install                          # dépendances du shell, applique aussi le patch react-native-webview
npm run build:userscript             # génère src/injection/userscript-source.ts (fichier non versionné)
cd ..
```

Pendant le `npm install` du shell, vérifier que la sortie contient bien cette ligne. Elle prouve que le patch du bloqueur de publicités est appliqué :

```
react-native-webview@13.16.1 ✔
```

Indiquer ensuite à Gradle où se trouve le SDK Android. Ce fichier est propre à chaque poste et n'est pas versionné :

```bash
# macOS
echo "sdk.dir=$HOME/Library/Android/sdk" > app/android/local.properties
# Linux
echo "sdk.dir=$HOME/Android/Sdk" > app/android/local.properties
```

Sous Windows, le chemin habituel est `C:/Users/<nom>/AppData/Local/Android/Sdk`, à écrire avec des barres obliques. Définir la variable d'environnement `ANDROID_HOME` sur ce même chemin fonctionne aussi.

Les dossiers `node_modules/`, `dist/` et les `build/` Android ne sont pas versionnés : ces commandes les recréent.

### 2. Configurer `.env`

```bash
cp .env.example .env
```

Le fichier `.env` est ignoré par git : chaque poste remplit le sien. Les URL d'API doivent inclure `https://`.

| Variable | Obligatoire | Valeur |
|---|---|---|
| `VITE_MAIN_API` | oui | `https://api.movix.men` (API distante, pas dans ce dépôt) |
| `VITE_PROXIES_EMBED_API` | oui | `https://proxiesembed.movix.men` (extraction des hébergeurs) |
| `VITE_TMDB_API_KEY` | oui | clé API TMDB v3 |
| `VITE_DEV_ACCESS_CODE` | oui en développement | clé VIP personnelle. Sans elle, l'API répond « VIP access required ». **Ne jamais la committer.** |
| `VITE_SITE_URL` | oui | `http://localhost:3000` en développement, l'adresse HTTPS d'hébergement en production |

Les autres entrées de `.env.example` sont héritées du site web et restent vides. Les variables sont lues au démarrage de Vite : relancer `npm run tv` après une modification.

La clé VIP est posée dans `localStorage['access_code']` de la WebView par `src/main.tsx`, en développement seulement. Sans elle, elle se saisit dans **Paramètres › Clé VIP Movix** ; la clé TMDB de même, dans **Paramètres › Clé TMDB**, qui prime alors sur `.env`.

### 3. Préparer la TV

1. Sur la TV, activer les options développeur : **Paramètres › À propos**, puis appuyer sept fois sur **Build**. Le libellé exact varie selon la marque.
2. Dans **Options pour les développeurs**, activer le **débogage USB** (ou **débogage réseau**).
3. Relever l'adresse IP de la TV dans **Paramètres › Réseau**.
4. Depuis le poste, se connecter et accepter la demande d'autorisation qui s'affiche sur la TV :

```bash
adb connect <ip-de-la-tv>:5555
adb devices                          # la TV doit apparaître avec l'état « device »
```

### 4. Premier lancement

Il faut deux terminaux, car `npm run tv` reste au premier plan.

```bash
# Terminal 1, à la racine : serveurs + ponts
TV_ADDR=<ip-de-la-tv>:5555 npm run tv

# Terminal 2 : compile et installe l'APK de développement (la première fois seulement)
cd app && npm run android
```

L'application s'ouvre sur la TV et affiche l'accueil. Les fois suivantes, le terminal 1 suffit.

> `TV_ADDR` vaut `192.168.1.9:5555` par défaut. Pour ne plus le saisir, l'exporter dans son profil shell ou modifier la valeur par défaut dans `scripts/tv-dev-up.sh` et `scripts/tv-dev.sh`.

## Développer au quotidien

### La commande unique

```bash
npm run tv                           # Ctrl+C pour tout arrêter
```

Elle fait, dans l'ordre :

1. démarre Vite (3000) et Metro (8081), ou réutilise ceux déjà lancés ;
2. se connecte à la TV et pose les deux ponts `adb reverse` ;
3. relance l'application sur la TV ;
4. réaffirme les ponts toutes les dix secondes, et se reconnecte si la TV a disparu.

Les journaux des deux serveurs sont dans `.tv-dev-logs/` (`vite.log`, `metro.log`). À l'arrêt, seuls les serveurs démarrés par le script sont coupés.

### La méthode manuelle

Équivalente, utile pour voir la sortie de chaque serveur dans son propre terminal :

```bash
adb connect <ip-de-la-tv>:5555
adb reverse tcp:3000 tcp:3000        # pont du site
adb reverse tcp:8081 tcp:8081        # pont du shell

npm run dev                          # terminal 1, à la racine : Vite
cd app && npm start                  # terminal 2 : Metro
```

Les ponts sont attachés à la connexion adb : ils tombent à chaque mise en veille de la TV ou coupure Wi-Fi. Le pont 8081 revient seul, **le pont 3000 jamais**. Pour les rétablir sans tout relancer :

```bash
./scripts/tv-dev.sh                  # rétablit les deux ponts
./scripts/tv-dev.sh --restart        # rétablit, puis relance l'application
```

### Ce qui se recharge à chaud, ce qui exige un nouvel APK

| Fichiers modifiés | Pris en compte par | Action |
|---|---|---|
| `src/**` (site) | Vite | rien, rechargement à chaud |
| `app/src/**` (shell JavaScript) | Metro | rien, rechargement à chaud |
| `userscript/movix.user.js` | génération | `cd app && npm run build:userscript` |
| `app/android/**` (Kotlin, manifeste, Gradle) | Gradle | recompiler et réinstaller l'APK |

```bash
cd app/android && ./gradlew assembleDebug \
  && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Observer la TV depuis le poste

```bash
adb shell input keyevent KEYCODE_DPAD_DOWN        # simuler une touche de télécommande
adb exec-out screencap -p > capture.png           # capture d'écran
adb logcat -d | grep CONSOLE                      # console JavaScript du site
```

## Dépannage

| Symptôme sur la TV | Cause | Remède |
|---|---|---|
| Écran « Movix injoignable » | le pont 3000 est tombé, ou Vite n'est pas lancé | `./scripts/tv-dev.sh --restart`, et vérifier que le port 3000 écoute |
| Écran rouge « Unable to load script » | le pont 8081 est tombé, ou Metro n'est pas lancé | `./scripts/tv-dev.sh --restart`, et vérifier que le port 8081 écoute |
| L'accueil reste vide, erreur « VIP access required » | `VITE_DEV_ACCESS_CODE` absent ou faux | corriger `.env`, relancer `npm run tv` |
| Affiches absentes | `VITE_TMDB_API_KEY` absent ou invalide | corriger `.env`, relancer `npm run tv` |
| `npm run tv` affiche « connexion impossible » | TV éteinte, mauvaise adresse, débogage inactif | vérifier `adb devices`, passer la bonne adresse dans `TV_ADDR` |
| `adb devices` affiche « unauthorized » | autorisation non acceptée sur la TV | accepter la fenêtre sur la TV, sinon révoquer les autorisations de débogage et reconnecter |
| Gradle échoue avec « SDK location not found » | `app/android/local.properties` absent | le créer avec la ligne `sdk.dir=…`, voir [l'étape 1](#1-cloner-et-installer) |
| Gradle réclame une plateforme, des build-tools ou un NDK | composant du SDK non installé | l'installer depuis le *SDK Manager* d'Android Studio, voir [les prérequis](#prérequis) |
| `npm install` du shell affiche « Failed to apply patch » | `node_modules` dans un état intermédiaire | `cd app && rm -rf node_modules && npm install` |
| `npm run android` hésite entre plusieurs appareils | un émulateur ou un téléphone est aussi connecté | ne garder que la TV dans `adb devices` : fermer l'émulateur, débrancher le téléphone |
| Gradle échoue sur la version de Java | le JDK actif n'est pas le 21 | régler `org.gradle.java.home` dans `~/.gradle/gradle.properties` |
| Le build du shell ne trouve pas `userscript-source` | fichier généré manquant sur un clone neuf | `cd app && npm run build:userscript` |
| Un port est déjà occupé | un ancien Vite ou Metro tourne encore | `lsof -nP -iTCP:3000 -sTCP:LISTEN` (ou `8081`), puis arrêter le processus |

## Vérifier son travail

```bash
npm run build                                                   # build de production du site
npm run lint                                                    # ESLint
node --test src/tv/__tests__/*.mjs src/tv/nav/__tests__/*.mjs   # tests de l'interface TV
cd app && node --test tests/*.mjs                               # tests du shell
cd app/android && ./gradlew testDebugUnitTest                   # tests Kotlin
```

Le typecheck du site a une particularité : `tsconfig.json` est un fichier « solution » qui ne vérifie rien par lui-même, et `tsconfig.app.json` vise TypeScript 6. Avec la version installée, passer par un fichier temporaire :

```bash
echo '{ "extends": "./tsconfig.app.json", "compilerOptions": { "ignoreDeprecations": "5.0" } }' > tsconfig.check.json \
  && npx tsc --noEmit -p tsconfig.check.json; rm -f tsconfig.check.json
```

Le lecteur hérité du projet amont garde plusieurs dizaines d'erreurs de type et de lint. Elles n'empêchent ni le build ni l'exécution : comparer le compte avant et après une modification, sans viser zéro.

## Adaptation à d'autres téléviseurs

Le projet a été optimisé sur un téléviseur de référence : Edenwood 4K, Android 11, WebView Chromium 152, viewport CSS de 960 × 540. Deux mécanismes automatiques l'adaptent aux autres.

- **Échelle de viewport** (`src/tv/tvScale.ts`) : l'interface est dessinée sur un gabarit de 960 × 540 pixels CSS. Sur un viewport différent, elle est mise à l'échelle par transformation. Sur le gabarit natif, rien n'est appliqué. Pour essayer une autre échelle, ajouter `?tvscale=0.8` à l'adresse.
- **Palier de performance** (`src/tv/devicePerformance.ts`) : les premières secondes de l'accueil sont chronométrées. Un appareil qui ne tient pas trente images par seconde passe en mode léger, animations coupées, au lancement suivant.

Les réglages de l'interface TV affichent le viewport, l'échelle et le palier mesurés. La page `/tvapp/diag` mesure en direct.

## Portage en APK autonome

L'objectif final est une application installée sur le téléviseur qui tourne sans le poste de développement. **C'est faisable en l'état, sans nouveau développement natif** : le build release embarque le code du shell, et le site se construit en une commande. Il reste trois étapes :

1. construire le site (`npm run build`) et le servir en **HTTPS** avec repli SPA, sur un domaine à soi. L'API Movix n'accepte que les origines de sa liste : faire ajouter ce domaine par l'équipe Movix, sinon la clé VIP et les sources sont refusées ;
2. la clé VIP et la clé TMDB se saisissent déjà dans les réglages TV : rien à embarquer dans le build ;
3. pointer le shell vers cette adresse, neutraliser la mise à jour automatique qui vise le dépôt Movix, fixer le nom et la version, signer, construire `assembleRelease`, installer.

La procédure détaillée, avec les fichiers à modifier, est dans [app/README.md](app/README.md#portage-en-apk-autonome).

## Structure du dépôt

```
src/                    site React 18 + Vite 5, servi dans la WebView
  tv/                   interface téléviseur (/tvapp/*), moteur de focus, télécommande du lecteur
  tv/settings/          réglages : saisie des clés VIP et TMDB
  pages/Watch/          pages de lecture (/watch/movie, /watch/tv)
  components/HLSPlayer  lecteur principal (hls.js) et son panneau de réglages TV
app/                    shell React Native 0.75 (Android uniquement)
  src/                  WebView, pont page <-> natif, scripts injectés, mise à jour d'APK
  android/              modules Kotlin : bloqueur, proxy média, télécommande, mise à jour, DNS, PiP
userscript/             source des extracteurs, générée dans le shell (npm run build:userscript)
scripts/                tv-dev-up.sh (npm run tv), tv-dev.sh (ponts), publish-app.mjs (publication d'APK)
```

Pour aller plus loin :

- [app/README.md](app/README.md) : le shell Android, son fonctionnement, le portage en APK autonome.
- [userscript/README.md](userscript/README.md) : le userscript d'extraction.
- [src/README.md](src/README.md) : notes du frontend amont.
- [CLAUDE.md](CLAUDE.md) et [AGENTS.md](AGENTS.md) : guides pour les assistants de code, avec les règles de travail du projet.

### Ce qui a été retiré

Le nettoyage du 15/09/2026 a déplacé, sans les effacer, les backends, les extensions, la WatchParty, le site souris, iOS et Chromecast dans un dossier local `.tv-backup/`. Ce dossier est volumineux et **n'est pas versionné** : il n'existe que sur le poste d'origine. Aucun code ne le référence.

## Licence et crédits

Ce projet dérive de Movix et reste distribué sous licence Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0). Le texte complet est dans [LICENSE](LICENSE). L'utilisation de ce code implique le maintien des crédits et l'interdiction stricte de le monétiser : aucune publicité, aucun abonnement.

## Avertissement

Ce projet est fourni uniquement à des fins éducatives, de recherche et de démonstration.
Il n'encourage ni ne cautionne une utilisation illégale, le contournement de droits, ou toute violation des lois applicables.
Chaque utilisateur est seul responsable de l'usage qu'il en fait.
