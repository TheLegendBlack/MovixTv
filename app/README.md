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

Objectif : **votre propre application**, installée sur le téléviseur et qui
fonctionne seule, sans poste de développement, sans Metro ni ponts adb. Rien de
natif à écrire : le build release embarque le shell (proxy média, bloqueur,
télécommande, mise à jour), et tout ce qui distingue votre application tient
dans deux fichiers d'**édition** (10/2026). Il reste à servir le site, puis à
configurer, signer et construire. Comptez une heure la première fois.

### 0. Prérequis

- Node.js 20 ou plus récent, `npm install` fait à la racine **et** dans `app/` ;
- JDK 21 (Gradle le cherche dans `~/.gradle/gradle.properties`,
  `org.gradle.java.home=…`) et le SDK Android avec ses build-tools ;
- un hébergement **HTTPS** pour le site (étape 2) ;
- pour installer : soit `adb` (débogage USB ou réseau activé sur la TV), soit
  l'application Downloader sur la TV (étape 8).

### 1. Construire le site

```bash
npm run build    # à la racine du dépôt -> dist/
```

Le build lit `.env` : `VITE_MAIN_API`, `VITE_PROXIES_EMBED_API`, `VITE_SITE_URL`.
**Laissez vides `VITE_TMDB_API_KEY` et `VITE_DEV_ACCESS_CODE`** pour un build
distribué : une clé mise dans le build est lisible par quiconque ouvre le site.
Chaque utilisateur saisit ses clés sur sa TV, dans **Paramètres › Clé TMDB**
(clé gratuite sur themoviedb.org) et **Paramètres › Clé VIP Movix** ; elles
restent dans le stockage de sa WebView.

### 2. Servir `dist/` en HTTPS

Le pont natif ne fait confiance qu'à une origine `https` en release. Le site a
besoin d'un **repli SPA** (toute route inconnue renvoie `index.html`) :
Cloudflare Pages (`_redirects` : `/* /index.html 200`), Netlify, GitHub Pages
(copie d'`index.html` en `404.html`), ou un serveur à vous (nginx :
`try_files $uri /index.html`).

**L'API Movix filtre les origines** (`api.movix.men`, CORS) : tant que l'équipe
Movix n'a pas ajouté votre domaine à sa liste, la clé VIP et les sources sont
refusées depuis votre site (préflight 403, mesuré le 11/10/2026). Demandez-le
avant de distribuer l'application.

### 3. Configurer l'édition du shell : `app/src/edition.ts`

| Constante | Rôle | Pour votre application |
|---|---|---|
| `EDITION_APP_NAME` | nom affiché sur l'écran de mise à jour | votre nom, par exemple `'Freedom'` |
| `EDITION_SITE_URL` | site chargé par la WebView | `'https://votre-domaine'` (`null` chercherait le site Movix) |
| `EDITION_UPDATE_MANIFEST_URL` | manifeste des mises à jour | `'https://votre-domaine/version.json'`, ou `''` pour ne jamais vérifier. **Pas `null`**, qui proposerait l'APK Movix par-dessus le vôtre |
| `EDITION_AUTO_UPDATE` | `true` : la mise à jour se télécharge seule au lancement ; `false` : une fenêtre la propose | au choix |
| `EDITION_LOGO` | logo de l'écran de mise à jour | `require('…/votre-icone.png')` |

### 4. Identité Android : `app/android/app/edition.properties`

Ce fichier n'existe pas dans le dépôt ; sans lui, le build garde l'identité
d'origine (`com.movix.app`, « Movix », version 2.6.5 / 42). Créez-le :

```properties
applicationId=tv.votre.app
appName=Freedom
versionCode=1
versionName=1.0.0
appIcon=@mipmap/ic_launcher_freedom
appRoundIcon=@mipmap/ic_launcher_freedom_round
appBanner=@drawable/banner_freedom
```

- `applicationId` : un identifiant à vous, pour cohabiter avec Movix sur la
  même TV. Il ne change plus ensuite : un autre identifiant est une autre
  application.
- `versionCode` : un entier à **augmenter à chaque publication** ; c'est lui que
  l'application compare au manifeste pour se mettre à jour.
- Icônes et bannière : déposez-les sous `app/android/app/src/edition/res/`
  (`mipmap-mdpi` à `mipmap-xxxhdpi` pour l'icône, de 48 à 192 px de côté ;
  `drawable/` pour la bannière du launcher Android TV, 320 × 180 px), puis
  nommez-les dans le fichier ci-dessus. Sans ces trois lignes, les images Movix
  restent.

### 5. Signer

Sans clé, Gradle signe la release avec la clé de débogage de votre machine :
les mises à jour ne passeraient plus si vous changez de poste. Créez une clé
pérenne :

```bash
keytool -genkeypair -v -keystore ~/freedom-release.jks -alias freedom -keyalg RSA -keysize 2048 -validity 10000
```

puis `app/android/app/keystore.properties` (gitignoré, ne jamais le committer) :

```properties
MOVIX_RELEASE_STORE_FILE=/Users/<vous>/freedom-release.jks
MOVIX_RELEASE_STORE_PASSWORD=…
MOVIX_RELEASE_KEY_ALIAS=freedom
MOVIX_RELEASE_KEY_PASSWORD=…
```

**Sauvegardez la clé et ses mots de passe hors de la machine.** Perdue, plus
aucune mise à jour ne s'installera : Android refuse un APK signé autrement, et
changer de clé impose de désinstaller, ce qui efface le stockage de la WebView
(clés, progression, réglages).

### 6. Construire

```bash
cd app && npm run build:userscript
cd android && ./gradlew assembleRelease
# -> app/android/app/build/outputs/apk/release/app-release.apk
```

L'APK release n'emporte que les variantes ARM (`armeabi-v7a`, `arm64-v8a`) :
celles des téléviseurs et boîtiers Android, environ 38 Mo. Le build debug garde
aussi x86 pour les émulateurs.

### 7. Publier les mises à jour

L'application lit au lancement le manifeste donné par
`EDITION_UPDATE_MANIFEST_URL` et propose l'APK s'il porte un `buildNumber` plus
grand que le sien ; elle vérifie l'empreinte SHA-256 avant d'installer. La
commande à la racine prépare les deux fichiers :

```bash
MOVIX_APK_URL=https://votre-domaine/freedom.apk node scripts/publish-app.mjs
```

Elle exige `keystore.properties`, lit la version dans `edition.properties`,
demande les notes de version, construit, puis écrit `app/version.json` et
`app/movix-android.apk`. Servez-les aux adresses annoncées (le JSON à celle de
`EDITION_UPDATE_MANIFEST_URL`, l'APK à `MOVIX_APK_URL`, en HTTPS). Forme du
manifeste :

```json
{
  "version": "1.0.1",
  "buildNumber": 2,
  "apkUrl": "https://votre-domaine/freedom.apk",
  "apkSizeBytes": 39958311,
  "apkSha256": "<64 caractères hexadécimaux>",
  "mandatory": false,
  "releasedAt": "2026-10-14T12:00:00.000Z",
  "releaseNotes": { "fr": "Ce qui change.", "en": "What changed." }
}
```

### 8. Installer sur la TV

- **Par adb** : `adb install -r app/android/app/build/outputs/apk/release/app-release.apk`.
- **Sans PC** : servez l'APK en HTTPS, installez « Downloader » (AFTVnews) depuis
  le Play Store de la TV et tapez son adresse. Android demande alors, dans
  l'ordre : d'autoriser Downloader à installer des applications (« Paramètres »,
  activer Downloader, Retour), « Installer », puis, la première fois, **Google
  Play Protect** bloque une application qu'il ne connaît pas : « Plus de
  détails », puis « Installer quand même ». À la première ouverture, l'application
  propose le DNS Cloudflare puis Android demande la connexion VPN qui
  l'applique (voir plus bas).

Vérifiez ensuite, PC éteint : l'accueil se charge depuis votre adresse (après
saisie de la clé TMDB), un titre se lit (la clé VIP est en place), la
télécommande et les touches média répondent, la bascule du bloqueur est visible
dans les réglages.


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
