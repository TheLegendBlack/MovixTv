# Movix TV — shell Android

Le shell est une application React Native 0.75, **Android uniquement**, qui
affiche le site Movix TV (`../src/`) dans une WebView et lui prête ce qu'une
page web n'a pas : un proxy média natif, un bloqueur de publicités, le relais
des touches de la télécommande, la mise à jour d'APK, un DNS Cloudflare
optionnel, le maintien de l'écran allumé et l'image dans l'image.

iOS, Chromecast, la barre d'adresse et l'écran de réglages tactiles de la
version mobile d'origine ont été retirés le 15/09/2026 (archivés dans
`../.tv-backup/suppression-2026-09-15/app/`).

## Architecture

```
app/
├── src/
│   ├── App.tsx                        # DNS au premier lancement, mise à jour d'APK, écran unique
│   ├── screens/
│   │   ├── BrowserScreen.tsx          # La WebView plein cadre + écran d'erreur quand tous les miroirs échouent
│   │   └── UpdateScreen.tsx           # Téléchargement / installation d'une mise à jour
│   ├── components/
│   │   ├── WebViewBrowser.tsx         # WebView : injection, bloqueur, relais télécommande, Retour
│   │   ├── UpdateDialog.tsx, TvButton.tsx, MirrorErrorScreen.tsx
│   ├── services/
│   │   ├── bridge.ts                  # Pont page <-> natif : proxy média, PiP, Retour, bloqueur, requêtes GM_*
│   │   ├── addressResolver.ts         # Adresse du site : court-circuit dev, sinon rentry -> address.json -> repli
│   │   ├── adBlock.ts, tvRemote.ts, tvBack.ts, dns.ts, playbackAwake.ts, pictureInPicture.ts
│   │   ├── mediaProxyHeaders.ts, mediaProxyRouting.ts, nativePlayback.ts, networkJournal.ts
│   │   └── apkInstaller.ts, updateDownloader.ts, versionCheck.ts, updateResume.ts
│   ├── injection/
│   │   ├── inject.ts                  # Assemble les scripts injectés avant le site
│   │   ├── tv-shim.ts                 # MovixNative.isTv, événements télécommande et Retour
│   │   ├── bridge-runtime.ts          # API GM_* côté page, routage du proxy média
│   │   ├── picture-in-picture-shim.ts, playback-awake-shim.ts
│   │   └── userscript-source.ts       # GÉNÉRÉ depuis ../userscript/movix.user.js
│   └── config/index.ts                # Adresse du site, agents utilisateur, mise à jour
├── android/app/src/main/java/com/movix/app/
│   ├── adblock/                       # Bloqueur : liste d'hôtes, règles par Referer, préférence
│   ├── proxy/                         # Proxy média local (Cronet, en-têtes, playlists HLS)
│   ├── device/                        # Détection TV, relais des touches média
│   ├── update/, dns/, pip/, playback/
│   └── MainActivity.kt, MainApplication.kt
├── patches/react-native-webview+13.16.1.patch   # hook `requestInterceptor` (bloqueur) et `isTopFrame`
├── scripts/build-userscript.js
└── tests/                             # node --test
```

### Comment ça marche

1. Au lancement, `addressResolver` décide quelle adresse charger : en build debug, `DEV_SITE_URL` (`http://localhost:3000`, le Vite du poste de travail joint par `adb reverse`) ; en release, la découverte rentry → `address.json` → repli `FALLBACK_CONFIG.PRIMARY_URL`.
2. La WebView charge `<adresse>/tvapp` avec l'agent utilisateur TV, après avoir injecté les shims et le userscript.
3. Le site parle au natif par `postMessage` ; le pont ne répond qu'aux origines de confiance (`https` de l'adresse chargée, plus `localhost:3000` en debug seulement).
4. Les requêtes de la page qui exigent des en-têtes ou passent par un CDN hostile transitent par le proxy média local ; les corps de segments ne passent jamais par le pont JavaScript.
5. Les touches de la télécommande arrivent au site comme des `keydown` ; le Retour est négocié entre le site et le shell.

## Prérequis

- Node.js 20+, npm
- Android Studio ou le SDK Android en ligne de commande, `adb`
- **JDK 21** pour Gradle, déclaré dans `~/.gradle/gradle.properties` (`org.gradle.java.home=…`). Un JDK 25 par défaut fait échouer la résolution du plugin React Native.
- Un téléviseur Android sur le réseau, débogage adb activé

## Installation et lancement en développement

```bash
cd app
npm install                 # applique aussi le patch react-native-webview (patch-package)
npm run build:userscript    # régénère src/injection/userscript-source.ts
adb connect <ip-de-la-tv>:5555
npm run android             # build debug + installation
```

Sur un clone neuf, créer d'abord `android/local.properties` avec la ligne
`sdk.dir=<chemin du SDK Android>` : ce fichier n'est pas versionné, et Gradle
échoue sans lui (« SDK location not found »). Le détail par système est dans le
[README racine](../README.md#1-cloner-et-installer).

Le plus simple ensuite est `npm run tv` depuis la racine : il lance Vite, Metro
et les ponts `adb reverse`, et les relance quand la connexion adb tombe. Les
modifications de `src/` (site) et `app/src/` (shell) sont prises à chaud ;
tout changement sous `app/android/` exige un nouvel APK :

```bash
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Vérifications : `node --test tests/*.mjs`, `cd android && ./gradlew testDebugUnitTest`.

## Portage en APK autonome

Objectif : une application installée sur le téléviseur qui fonctionne sans le
poste de développement, sans Metro ni ponts adb. **En l'état du code, c'est
faisable directement**, sans nouveau développement natif : le build release
embarque déjà le bundle JavaScript, le proxy, le bloqueur et la télécommande
sont finis, et le site se construit en une commande. Il reste à décider où le
site est servi, puis à configurer le shell en conséquence. La procédure, dans l'ordre :

### 1. Construire le site

```bash
cd ..            # racine du dépôt
npm run build    # -> dist/
```

Le build lit `.env` (`VITE_MAIN_API`, `VITE_PROXIES_EMBED_API`, `VITE_SITE_URL`, `VITE_TMDB_API_KEY`).

### 2. La clé VIP arrive par les réglages

`src/main.tsx` ne pose la clé (`VITE_DEV_ACCESS_CODE`) dans le stockage de la
WebView **qu'en développement** ; un build de production ne l'embarque pas.
Depuis 10/2026, l'interface TV a son écran de saisie : **Paramètres › Clé VIP
Movix**, au clavier virtuel, qui écrit `localStorage['access_code']` et vérifie
la clé auprès de l'API. La clé TMDB se saisit de même (**Paramètres › Clé
TMDB**) et prime sur `VITE_TMDB_API_KEY`. Rien à embarquer dans le build.

### 3. Servir `dist/` en HTTPS

Le pont natif ne fait confiance qu'à une origine `https` en release : le site
doit être servi en HTTPS, avec un repli SPA (toute route inconnue renvoie
`index.html`, car le site utilise l'historique du navigateur). Toute solution
d'hébergement statique convient : Cloudflare Pages (`_redirects` :
`/* /index.html 200`), Netlify, GitHub Pages (avec la copie d'`index.html` en
`404.html`), ou un serveur personnel (`try_files $uri /index.html` avec nginx).
Le domaine peut être privé et obscur ; ce n'est ni movix.men ni movix.fun.

Embarquer `dist/` dans l'APK lui-même est possible mais n'est pas direct : il
faudrait un petit serveur HTTP local dans le shell et l'ajout de son origine
aux origines de confiance du pont. À envisager plus tard.

### 4. Pointer le shell vers cette adresse

Dans `src/services/addressResolver.ts`, le court-circuit de développement est
gardé par `__DEV__` : en release, le shell interroge rentry et `address.json`
du projet Movix, qui renverraient movix.men. Remplacer ce court-circuit par une
adresse fixe :

```ts
// resolveAddressConfig(), avant l'étape rentry
return { ...HARDCODED_FALLBACK, primaryUrl: 'https://<votre-domaine>', mirrors: [] };
```

et aligner `CONFIG.SITE_URL` et `FALLBACK_CONFIG.PRIMARY_URL` dans
`src/config/index.ts`. Mettre `DEV_SITE_URL` à `null` n'est pas nécessaire :
il est ignoré en release.

### 5. Neutraliser ou reprendre la mise à jour automatique

`src/App.tsx` vérifie `version.json` sur le dépôt GitHub de Movix
(`FALLBACK_CONFIG.GITHUB_URL`) et proposerait d'installer l'APK amont
par-dessus le vôtre. Soit forcer `updateSourceUrl = null`, soit publier votre
propre `version.json` et votre APK (le script `npm run app:publish` à la racine
fait le build release, calcule la somme SHA-256 et écrit le manifeste ; adapter
`APK_URL` dans `scripts/publish-app.mjs` et `GITHUB_URL` dans la config).

### 6. Identité et version

- Nom affiché : `app_name` dans `android/app/src/main/res/values/strings.xml` et `CONFIG.APP_NAME` (par exemple « Freedom »).
- Identifiant : `applicationId` dans `android/app/build.gradle` (`com.movix.app`). Le changer permet de cohabiter avec l'application Movix officielle ; le garder permet d'installer par-dessus le build de développement actuel.
- Version : `versionCode` et `versionName` dans le même fichier.

### 7. Signer

Sans clé, Gradle signe la release avec la clé de débogage de la machine, ce qui
suffit pour une seule télévision mais lie les mises à jour futures à ce poste.
Pour une clé pérenne :

```bash
keytool -genkeypair -v -keystore ~/movix-tv-release.jks -alias movixtv -keyalg RSA -keysize 2048 -validity 10000
```

puis `android/app/keystore.properties` (gitignoré, ne jamais le committer) :

```
MOVIX_RELEASE_STORE_FILE=/Users/<vous>/movix-tv-release.jks
MOVIX_RELEASE_STORE_PASSWORD=…
MOVIX_RELEASE_KEY_ALIAS=movixtv
MOVIX_RELEASE_KEY_PASSWORD=…
```

Changer de signature impose de désinstaller l'application en place
(`adb uninstall com.movix.app`), ce qui efface le stockage de la WebView :
progression de lecture, liste et clé VIP. À faire une fois, en connaissance de cause.

### 8. Construire et installer

```bash
cd app && npm run build:userscript
cd android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Puis, PC éteint : lancer l'application depuis le launcher de la TV, vérifier
que l'accueil se charge depuis votre adresse, qu'un titre se lit (la clé VIP
est donc bien en place), que la télécommande et les touches média répondent,
et que la bascule du bloqueur est visible dans les réglages.

## DNS Cloudflare

Au premier lancement, l'application propose d'activer un DNS 1.1.1.1 par un
VPN local Android (`VpnService`) : seules les requêtes DNS sont redirigées,
aucune donnée ne transite ailleurs, et le trafic de l'application elle-même
est exclu du VPN. Refuser ne gêne rien si le réseau n'est pas filtré.

## Mise à jour du userscript

Éditer `../userscript/movix.user.js`, jamais `src/injection/userscript-source.ts`
(généré), puis `npm run build:userscript`. En développement le bundle repart
par Metro ; en release il est embarqué au build suivant.

## Notes

- Les modules natifs sont enregistrés dans `MainApplication.kt` : `DnsPackage`, `DevicePackage`, `UpdatePackage`, `MediaProxyPackage`, `PlaybackAwakePackage`, `PictureInPicturePackage`, `AdBlockPackage` ; le bloqueur est installé au démarrage (`AdBlockInterceptor.install`).
- Le manifeste déclare `android.software.leanback` non obligatoire et fournit une bannière `tv_banner.png` pour le launcher.
- `network_security_config.xml` autorise le trafic en clair : certains hébergeurs servent leurs flux depuis des adresses IP nues sans certificat.
- La mesure sur la TV se fait par adb : `adb exec-out screencap -p` pour une capture, `adb logcat -d | grep CONSOLE` pour la console du site, `adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE` pour une touche.
