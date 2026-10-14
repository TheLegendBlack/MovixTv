import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
// Le registre des rangées vit dans `rowRegistry.ts` depuis le 12/10/2026 ;
// les tests qui lisaient `tmdb.ts` lisent les deux.
const readTmdb = async () => `${await read('src/tv/data/tmdb.ts')}\n${await read('src/tv/data/rowRegistry.ts')}`;

test('la fiche ne défile pas, elle glisse', async () => {
  const page = await read('src/tv/TvDetails.tsx');

  // `TvFocusProvider` appelle `scrollIntoView({ block: 'center' })` à chaque
  // déplacement. Si le document défilait, chaque descente recentrerait la cible
  // et le hero remonterait par à-coups.
  assert.match(page, /className="relative h-\[var\(--tv-screen-height,100vh\)\] overflow-hidden"/);
  assert.match(page, /transform: `translateY\(\$\{inContent \? -TABS_SHIFT : 0\}px\)`/);

  // Gabarit 960×540 et non 1280×720 : c'est le viewport CSS mesuré sur la TV.
  assert.match(page, /const SCREEN_HEIGHT = 540;/);
  assert.match(page, /960×540/);
});

test('l\'état de la fiche se déduit du focus, sans drapeau', async () => {
  const page = await read('src/tv/TvDetails.tsx');

  // Un drapeau se désynchroniserait au premier chemin imprévu : retour arrière,
  // clic souris, remontée par Haut.
  assert.match(page, /const inContent = focused \? isContentScope\(focused\.scopeId\) : false;/);
  assert.doesNotMatch(page, /useState\(false\)[^\n]*inContent/);

  // Le hero reste monté une fois replié, sinon Haut depuis les onglets n'aurait
  // plus de portée où revenir — et la fiche ne se rouvrirait jamais.
  const hero = await read('src/tv/details/TvDetailsHero.tsx');
  assert.match(hero, /collapsed \? 'opacity-0' : 'opacity-100'/);
  assert.doesNotMatch(hero, /if \(collapsed\) return null/);
});

test('Retour remonte d\'un niveau avant de quitter la fiche', async () => {
  const [page, layout, stack] = await Promise.all([
    read('src/tv/TvDetails.tsx'),
    read('src/tv/TvLayout.tsx'),
    read('src/tv/nav/tvBackStack.ts'),
  ]);

  // Deux écouteurs sur `movix-tv-back` s'exécuteraient tous les deux : la page
  // reculerait en même temps qu'elle remonterait d'un niveau. D'où la pile.
  assert.match(stack, /export function pushBackHandler/);
  assert.match(stack, /return handler \? handler\(\) : false;/);
  assert.match(layout, /if \(runTopBackHandler\(\)\) return;\s*\n\s*navigate\(-1\);/);

  // La fiche ne consomme Retour que si le focus est descendu dans un onglet.
  assert.match(page, /if \(!inContent\) return false;/);
  assert.match(page, /focus\(\{ scopeId: SCOPE_TABS, index: activeTabIndex\.current \}\)/);
});

test('la progression est lue, jamais écrite, par la fiche', async () => {
  const progress = await read('src/tv/data/watchProgress.ts');

  // L'écriture appartient à HLSPlayer. Un second écrivain diverge au premier
  // changement de format.
  assert.doesNotMatch(progress, /localStorage\.setItem/);

  // Les clés doivent correspondre exactement à `getProgressKey` du lecteur.
  const player = await read('src/components/HLSPlayer.tsx');
  assert.match(player, /`progress_\$\{movieId\}`/);
  assert.match(player, /`progress_tv_\$\{tvShowId\}_s\$\{seasonNumber\}_e\$\{episodeNumber\}`/);
  assert.match(progress, /`progress_\$\{movieId\}`/);
  assert.match(progress, /`progress_tv_\$\{tvId\}_s\$\{season\}_e\$\{episode\}`/);

  // Le lecteur n'écrit rien après `duration - 30` : un épisode vu en entier
  // plafonne vers 98 %. Raisonner en égalité ne marquerait jamais rien comme vu.
  assert.match(player, /video\.currentTime > video\.duration - 30/);
  assert.match(progress, /ratio >= finishedRatio\(\)/);
});

test('« Ma liste » écrit la forme exacte attendue par le site', async () => {
  const list = await read('src/tv/data/watchlist.ts');

  // Le site lit `poster_path` — le chemin TMDB brut, pas une URL. Une entrée
  // écrite depuis la TV avec un champ en moins donne une vignette vide. (La
  // page souris qui le lisait n'est plus dans ce clone depuis le 15/09/2026 ;
  // la forme reste celle du compte Movix, partagée avec le site distant.)
  assert.match(list, /poster_path: entry\.posterPath/);
  assert.match(list, /addedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(list, /'watchlist_tv' : 'watchlist_movie'/);
});

test('aucune action inerte dans le hero', async () => {
  const page = await read('src/tv/TvDetails.tsx');

  // TMDB ne donne qu'une clé YouTube, et HLSPlayer lit du HLS et du MP4. Le
  // bouton reste absent tant qu'aucune route ne sait jouer une clé.
  assert.match(page, /const TRAILERS_PLAYABLE = false;/);
  assert.match(page, /TRAILERS_PLAYABLE && details\.trailerKey/);
});

test('le repli de navigation suit la route réellement montée', async () => {
  const [page, router] = await Promise.all([
    read('src/tv/TvDetails.tsx'),
    read('src/tv/TvApp.tsx'),
  ]);

  // La fiche est montée sur `/tvapp/:mediaType/:id`, sans segment intermédiaire.
  assert.match(router, /path="\/:mediaType\/:id"/);
  assert.match(page, /`\/tvapp\/\$\{nextType\}\/\$\{nextId\}`/);
});

test('un voisin dont l\'identifiant change réenregistre la portée', async () => {
  const [hooks, rail, page] = await Promise.all([
    read('src/tv/nav/hooks.ts'),
    read('src/tv/details/TvSeasonRail.tsx'),
    read('src/tv/TvDetails.tsx'),
  ]);

  // Le rail pointe vers une portée dont l'identifiant porte la saison. Comme
  // `count` ne bouge pas d'une saison à l'autre, dépendre d'une ref seule
  // gelait le voisin au montage et le passage vers la liste mourait au premier
  // changement de saison.
  assert.match(page, /const episodesScope = \(season: number \| null\) => `fiche-episodes-s\$\{season \?\? 0\}`/);
  assert.match(rail, /right: episodesScopeId/);

  // La dépendance porte sur le CONTENU des voisins, pas sur l'objet — un
  // littéral recréé à chaque rendu ré-enregistrerait la portée en boucle.
  assert.match(hooks, /const neighborsKey = \[/);
  const deps = hooks.match(/\}, \[registerScope,[^\]]*\]\);/);
  assert.ok(deps, 'tableau de dépendances introuvable');
  assert.match(deps[0], /neighborsKey/, 'la clé de contenu doit être une dépendance');
  assert.doesNotMatch(deps[0], /\bneighbors\b(?!Key)/, 'l\'objet lui-même ne doit pas y être');

  // `null` et `undefined` ne disent pas la même chose : le premier ferme la
  // sortie, le second s'en remet à l'ordre du DOM. La clé doit les distinguer.
  assert.match(hooks, /value === null \? '\\u0000' : value/);
});

test('la reprise de lecture lit le format du lecteur, sans le redéfinir', async () => {
  const [row, player, progress] = await Promise.all([
    read('src/tv/data/useContinueWatching.ts'),
    read('src/components/HLSPlayer.tsx'),
    read('src/tv/data/watchProgress.ts'),
  ]);

  // Une seconde source de vérité pour la progression divergerait en silence.
  // On vise les clés réellement lues, pas le commentaire qui explique pourquoi
  // `movix:tv:progress` a été abandonnée.
  const keys = [...row.matchAll(/(?:const \w+_KEY = |localStorage\.getItem\()'([^']+)'/g)]
    .map(match => match[1]);
  assert.ok(!keys.includes('movix:tv:progress'), `clé fantôme encore lue : ${keys}`);
  assert.ok(keys.includes('movix:tv:watch-meta'), `clé de métadonnées absente : ${keys}`);
  assert.match(row, /\^progress_\(\\d\+\)\$/);
  assert.match(row, /\^progress_tv_\(\\d\+\)_s\(\\d\+\)_e\(\\d\+\)\$/);
  assert.match(player, /`progress_tv_\$\{tvShowId\}_s\$\{seasonNumber\}_e\$\{episodeNumber\}`/);

  // Le lecteur écrit `timestamp` en chaîne ISO. `Number()` y donnerait NaN,
  // donc 0 partout, et le tri par récence ne trierait plus rien.
  assert.match(player, /timestamp: new Date\(\)\.toISOString\(\)/);
  assert.match(row, /timestamp\?: string \| number;/);
  assert.match(row, /Date\.parse\(value\)/);
  assert.match(progress, /Date\.parse\(data\.timestamp\)/);

  // Ce que le lecteur ne stocke pas — titre, image, nom d'épisode — lui est
  // demandé au démarrage plutôt que résolu contre TMDB au montage de l'accueil.
  assert.match(row, /export function rememberWatchMeta/);
  assert.match(player, /rememberWatchMeta\(key, \{/);
  assert.match(player, /backdropPath: currentEpisodeInfo\?\.still_path \?\? tvShow\?\.backdrop_path/);

  // Chemin TMDB brut et non URL : la taille dépend du gabarit de carte.
  assert.doesNotMatch(row, /backdropPath: `https:/);
  assert.match(row, /stillUrl\(entryMeta\.backdropPath \?\? null\)/);
});

test('la géométrie de la bannière se dérive, elle ne se recopie pas', async () => {
  const home = await read('src/tv/TvBrowse.tsx');

  // Les points tombaient 22 px sous la ligne où les rangées remontent : deux
  // constantes indépendantes qui se contredisaient.
  assert.match(home, /const HERO_DOTS_BOTTOM = ROW_OVERLAP \+ DOTS_CLEARANCE;/);
  assert.match(home, /const HERO_CONTENT_BOTTOM = HERO_DOTS_BOTTOM \+ DOTS_HEIGHT \+ BUTTON_CLEARANCE;/);
  assert.match(home, /bottom: HERO_DOTS_BOTTOM/);
  assert.match(home, /paddingBottom: HERO_CONTENT_BOTTOM/);
  assert.doesNotMatch(home, /className="absolute bottom-6/);

  // `clip` rogne sans créer de conteneur défilable — c'est ce qui empêche
  // `element.focus()` d'aller y défiler par-dessus notre `transform`.
  assert.match(home, /h-\[var\(--tv-screen-height,100vh\)\] w-full overflow-clip/);
});

test('le document ne défile jamais sous l\'interface TV', async () => {
  const [lock, layout, home, app] = await Promise.all([
    read('src/tv/nav/useTvViewportLock.ts'),
    read('src/tv/TvLayout.tsx'),
    read('src/tv/TvBrowse.tsx'),
    read('src/App.tsx'),
  ]);

  // `clip` et non `hidden` : `hidden` laisse un conteneur défilable par
  // programme, ce dont `element.focus()` a besoin pour nuire.
  assert.match(lock, /overflow = 'clip'/);
  assert.doesNotMatch(lock, /overflow = 'hidden'/);
  // L'état antérieur est restauré : le site souris doit continuer de défiler.
  assert.match(lock, /html\.style\.overflow = previous\.htmlOverflow;/);

  // Posé sur la coquille, pas sur un écran : la fiche, les catalogues et la
  // recherche sont exposés au même défilement parasite.
  assert.match(layout, /useTvViewportLock\(\);/);
  assert.doesNotMatch(home, /useTvViewportLock/);

  // Correction en amont : le pied de page n'est plus monté du tout. Depuis le
  // 15/09/2026 la racine du site n'en a même plus : ni <Footer>, ni <Header>.
  assert.doesNotMatch(app, /<Footer|<Header/);

  // Et la correction de fond, dans le moteur de focus.
  const provider = await read('src/tv/nav/TvFocusProvider.tsx');
  assert.match(provider, /focus\(\{ preventScroll: true \}\)/);
});

test('la barre de navigation ne pousse pas la bannière', async () => {
  const home = await read('src/tv/TvBrowse.tsx');

  // En flux, ses 64 px décalaient toute la géométrie verticale de la bannière.
  const chrome = home.match(/<div\s+ref=\{chromeRef\}[\s\S]*?>/);
  assert.ok(chrome, 'conteneur de la barre introuvable');
  assert.match(chrome[0], /absolute inset-x-0 top-0/);

  // Elle s'escamote quand le focus descend : plus atteignable d'un appui, et le
  // titre de la bannière lui passait au travers en glissant.
  assert.match(home, /const applyChrome = useCallback\(\(hidden: boolean\)/);
  assert.match(home, /applyChrome\(true\)/);
  assert.match(home, /applyChrome\(false\)/);

  // Opacité et translate seulement : le compositeur les traite sans mise en page.
  const body = home.match(/const applyChrome = useCallback[\s\S]*?\n {2}\}, \[\]\);/);
  assert.match(body[0], /style\.opacity/);
  assert.match(body[0], /translate3d/);
  assert.doesNotMatch(body[0], /style\.(height|display|top)\b/);
});

test('« Voir plus » n\'apparaît que sur les rangées réellement paginables', async () => {
  const [tmdb, home, row] = await Promise.all([
    readTmdb(),
    read('src/tv/TvBrowse.tsx'),
    read('src/tv/components/TvRow.tsx'),
  ]);

  // Une carte présente partout ne signale plus rien : les instantanés — ce qui
  // est vrai aujourd'hui et faux demain — ne la portent pas, ni les rangées
  // génériques de fin de page.
  const specs = tmdb.match(/const ROWS: RowSpec\[\] = \[[\s\S]*?\n\];/);
  assert.ok(specs, 'table des rangées introuvable');

  for (const id of ['tendances', 'films-selection', 'films-top10']) {
    const spec = specs[0].match(new RegExp(`id: '${id}',[\\s\\S]*?\\n {2}\\},`));
    assert.ok(spec, `rangée ${id} introuvable`);
    assert.doesNotMatch(spec[0], /collection: true/);
  }

  // La carte n'est rendue que si le descripteur est fourni.
  assert.match(home, /more=\{row\.collection \? openCollection\(row\.id\) : undefined\}/);

  // Elle occupe un index logique de plus : le moteur navigue par index, donc
  // rien d'autre n'est à déclarer pour la rendre atteignable.
  assert.match(row, /const count = items\.length \+ \(more \? 1 : 0\);/);
  assert.match(row, /count,\n\s+neighbors,/);
  assert.match(row, /more && virtualItem\.index === items\.length/);
});

test('la collection interroge la même requête que la rangée', async () => {
  const [tmdb, page, app] = await Promise.all([
    readTmdb(),
    read('src/tv/TvCollection.tsx'),
    read('src/tv/TvApp.tsx'),
  ]);

  // Redéfinir des critères garantirait que « Voir plus » finisse par montrer
  // autre chose que la rangée qui y mène.
  // `findRowSpec` : la rangée du registre, ou la rangée sur mesure déclarée.
  assert.match(tmdb, /const spec = findRowSpec\(rowId\);/);
  assert.match(tmdb, /fetchSpecPage\(spec, page, signal\)/);
  assert.match(tmdb, /fetchSpecPage\(spec, 1, signal\)/);

  // La route est déclarée avant celle à deux segments dynamiques.
  const collection = app.indexOf('path="/collection/:rowId"');
  const media = app.indexOf('path="/:mediaType/:id"');
  assert.ok(collection > 0 && collection < media, 'ordre de routes incorrect');

  // Le verrou de défilement vient de la coquille : un second appel ici serait
  // redondant.
  assert.doesNotMatch(page, /useTvViewportLock\(\)/);

  // Grille régulière : la ligne se déduit de l'index, sans lire d'`offsetTop`.
  assert.match(page, /Math\.floor\(focusedIndex \/ COLUMNS\)/);
  // Accès de propriété, pas le mot : il apparaît dans le commentaire qui
  // explique justement pourquoi on ne le lit pas.
  assert.doesNotMatch(page, /\.offsetTop/);
});

test('les voisins de la recherche restent en miroir', async () => {
  const [search, keyboard] = await Promise.all([
    read('src/tv/TvSearch.tsx'),
    read('src/tv/components/TvKeyboard.tsx'),
  ]);

  // Seul écran à deux blocs côte à côte, donc le seul où l'axe horizontal doit
  // être déclaré des deux côtés. Une déclaration unilatérale rend un bloc
  // inatteignable — c'est le bug que la première version avait.
  assert.match(search, /rightNeighbor=\{RESULTS_SCOPE\}/);
  assert.match(keyboard, /neighbors: \{ right: rightNeighbor, down: downNeighbor \}/);
  assert.match(search, /left: KEYBOARD\.grid/);
  assert.match(search, /right: RESULTS_SCOPE/);

  // Le vertical suit le DOM, corrigé là où la disposition le contredit : le
  // clavier précède les résultats dans le DOM mais est à leur gauche.
  assert.match(search, /up: TV_TOP_NAV_SCOPE/);
  assert.match(search, /neighbors=\{\{ down: KEYBOARD\.grid \}\}/);
  // Bas depuis les suggestions ne doit pas sauter dans la grille d'en face.
  assert.match(search, /neighbors: \{ right: RESULTS_SCOPE, down: null \}/);

  // Les identifiants passent par la fabrique : la recherche les cible deux
  // fois, et une chaîne recopiée finirait par diverger.
  assert.match(keyboard, /export const tvKeyboardScopes/);
  assert.match(search, /const KEYBOARD = tvKeyboardScopes\(\);/);
});

test('la recherche ne défile pas et n\'interroge pas à chaque frappe', async () => {
  const search = await read('src/tv/TvSearch.tsx');

  // `clip` sur la grille : `hidden` en ferait une zone défilable que le
  // `scrollIntoView` du moteur viendrait déplacer par-dessus la nôtre.
  assert.match(search, /style=\{\{ overflow: 'clip' \}\}/);
  // La rangée se déduit de l'index — grille régulière, aucune mesure de mise
  // en page. La forme exacte de l'expression peut bouger, pas le principe.
  assert.match(search, /Math\.floor\(\w+ \/ RESULT_COLUMNS\)/);
  assert.doesNotMatch(search, /\.offsetTop/);

  // Une requête par frappe saturerait TMDB ; la précédente est annulée.
  assert.match(search, /const DEBOUNCE_MS = 450;/);
  assert.match(search, /controller\.abort\(\)/);
  assert.match(search, /if \(!controller\.signal\.aborted\)/);

  // Borne de saisie : une touche restée enfoncée ne doit pas produire un
  // millier de caractères.
  assert.match(search, /current\.length >= 100 \? current : current \+ character/);
});

test('le bandeau de prévisualisation se déduit du focus, sans câblage', async () => {
  const search = await read('src/tv/TvSearch.tsx');

  // Aucun état « je survole une carte » à tenir : un drapeau se
  // désynchroniserait au premier chemin imprévu, comme sur la fiche de détail.
  assert.match(search, /const \{ focused \} = useTvFocusContext\(\);/);
  assert.match(search, /focused\.scopeId === RESULTS_SCOPE/);
  assert.doesNotMatch(search, /useState\(false\)[^\n]*preview/i);

  // Le dernier titre reste affiché pendant que le bandeau s'efface : sinon il
  // se vide avant de disparaître, et ça clignote.
  assert.match(search, /const lastPreviewed = useRef<TvMediaItem \| null>\(null\);/);

  // Opaque et au-dessus : les rangées du dessus glissent dessous. Le bandeau
  // est partagé avec les pages de collection depuis le 15/09/2026.
  const banner = await read('src/tv/components/TvPreviewBanner.tsx');
  assert.match(banner, /z-10 flex items-start gap-6 bg-movix-ink/);
  assert.match(search, /<TvPreviewBanner/);

  // La géométrie se dérive : le décalage de grille ne peut pas diverger de la
  // hauteur du bandeau.
  assert.match(search, /const GRID_SHIFT = PREVIEW_HEIGHT \+ PREVIEW_GAP - PREVIEW_LIFT;/);
  assert.match(search, /shift - row \* RESULT_PITCH_Y/);

  // L'image attend que la télécommande se pose ; le texte, non.
  assert.match(banner, /PREVIEW_IMAGE_DELAY_MS/);
});

test('la barre se transforme sur la page qu\'on quitte, pas sur celle qui arrive', async () => {
  const nav = await read('src/tv/components/TvTopNav.tsx');

  // Le montage d'une page est l'instant le plus chargé pour le SoC : une
  // transition lancée là finit dans la même image peinte que son départ. La
  // recherche se monte donc déjà repliée.
  assert.match(nav, /const \[folded, setFolded\] = useState\(compact\);/);

  // Et le repli se joue avant de naviguer, sur la page courante.
  assert.match(nav, /const foldedThere = path === FOLDED_PATH;/);
  assert.match(nav, /setFolded\(foldedThere\);/);
  assert.match(nav, /setTimeout\(\(\) => navigate\(path\), MORPH_MS\)/);
  // Rien à animer entre deux pages de même forme : on part directement.
  assert.match(nav, /if \(foldedThere === folded\) \{\s*\n\s*navigate\(path\);/);
  // Garde contre le double appui pendant la transformation.
  assert.match(nav, /leaveTimer\.current !== null\) return;/);
});

test('la transformation est une sortie puis une entrée, jamais un fondu croisé', async () => {
  const nav = await read('src/tv/components/TvTopNav.tsx');

  // L'entrante attend que la sortante ait fini : un délai égal à une moitié.
  const style = nav.match(/const groupStyle = [\s\S]*?\n\};/);
  assert.ok(style, 'groupStyle introuvable');
  assert.match(style[0], /const delay = visible \? STEP_MS : 0;/);
  assert.match(style[0], /transition: `opacity \$\{STEP_MS\}ms ease \$\{delay\}ms, transform/);
  assert.match(nav, /const MORPH_MS = STEP_MS \* 2;/);

  // Seuls l'opacité et `transform` bougent — pas de largeur, pas de marge :
  // animer la mise en page ne démarrait pas sur la WebView du téléviseur.
  assert.doesNotMatch(style[0], /width|margin|padding/);
  assert.doesNotMatch(nav, /offsetWidth/);

  // Jamais masquée par `visibility` : le moteur doit pouvoir donner le focus
  // DOM à une pastille pendant qu'elle est effacée.
  assert.doesNotMatch(nav, /visibility: 'hidden'/);

  // La doublure est décorative : une seule des deux rangées est enregistrée,
  // sinon deux portées porteraient l'identifiant `nav`.
  const ghost = nav.match(/const TvNavGhostPills[\s\S]*?\n\};/);
  assert.ok(ghost, 'doublure introuvable');
  assert.doesNotMatch(ghost[0], /useFocusItem|useFocusScope/);
  assert.match(ghost[0], /focused\?\.scopeId === TV_TOP_NAV_SCOPE/);
  assert.match(nav, /\{real \? \(\s*\n\s*GROUP\.map/);
});

test('chaque page nomme des rangées qui existent vraiment', async () => {
  const [tmdb, browse, pageRows] = await Promise.all([
    readTmdb(),
    read('src/tv/TvBrowse.tsx'),
    read('src/tv/data/pages.ts'),
  ]);
  // La rangée de bannière de chaque page est déclarée avec sa liste dans
  // `TV_PAGES` : `page('Accueil', TV_HOME_ROWS, 'tendances')` (13/10/2026).
  const heroOf = name => {
    const entry = pageRows.match(new RegExp(`, ${name}, '([^']+)'\\)`));
    return entry ? `heroRowId="${entry[1]}"` : '';
  };

  // `ROWS` est un registre, les listes de page sont l'ordre d'affichage. Une
  // faute de frappe dans une liste ne casse rien : la rangée disparaît, en
  // silence. C'est exactement ce que ce test attrape.
  const specs = tmdb.match(/const ROWS: RowSpec\[\] = \[[\s\S]*?\n\];/);
  assert.ok(specs, 'table des rangées introuvable');
  const known = new Set([...specs[0].matchAll(/^ {4}id: '([^']+)',$/gm)].map(m => m[1]));
  assert.ok(known.size >= 20, `registre suspicieusement court : ${known.size}`);

  const listOf = name => {
    const block = tmdb.match(
      new RegExp(`export const ${name}: readonly string\\[\\] = \\[([\\s\\S]*?)\\n\\];`),
    );
    assert.ok(block, `liste ${name} introuvable`);
    return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  };

  const pages = {
    TV_HOME_ROWS: { ids: listOf('TV_HOME_ROWS'), hero: heroOf('TV_HOME_ROWS') },
    TV_MOVIE_ROWS: { ids: listOf('TV_MOVIE_ROWS'), hero: heroOf('TV_MOVIE_ROWS') },
    TV_SERIES_ROWS: { ids: listOf('TV_SERIES_ROWS'), hero: heroOf('TV_SERIES_ROWS') },
    TV_ANIME_ROWS: { ids: listOf('TV_ANIME_ROWS'), hero: heroOf('TV_ANIME_ROWS') },
  };

  for (const [name, page] of Object.entries(pages)) {
    for (const id of page.ids) {
      assert.ok(known.has(id), `${name} cite une rangée absente du registre : ${id}`);
    }
    assert.equal(new Set(page.ids).size, page.ids.length, `doublon dans ${name}`);

    // La bannière consomme les cinq premiers titres de sa rangée source et la
    // tronque d'autant. Une source hors liste ne serait jamais chargée : page
    // sans bannière, et cinq titres de trop dans la rangée qui les porte.
    const hero = page.hero.match(/heroRowId="([^"]+)"/);
    assert.ok(hero, `heroRowId absent pour ${name}`);
    assert.ok(
      page.ids.includes(hero[1]),
      `la bannière de ${name} vise ${hero[1]}, absent de la liste`,
    );
  }

  // Le squelette ne connaît aucune rangée par son nom : tout vient des props.
  assert.doesNotMatch(browse, /'tendances'|'films-selection'/);
  assert.match(browse, /row\.id === heroRowId/);
});

test('la clé VIP amorce aussi l\'habilitation, pas seulement le code', async () => {
  const [main, vip, resolve] = await Promise.all([
    read('src/main.tsx'),
    read('src/utils/vipUtils.ts'),
    read('src/utils/serverResolveRequest.ts'),
  ]);

  // `isUserVip()` lit `is_vip` de façon synchrone et ne l'amorce jamais : elle
  // ne rafraîchit en arrière-plan que si la valeur est DÉJÀ vraie.
  const reader = vip.match(/export function isUserVip\(\)[\s\S]*?\n\}/);
  assert.ok(reader, 'isUserVip introuvable');
  // Depuis la reprise amont du 11/10/2026, la lecture passe par
  // `readLocalStorage` (stockage protégé, `utils/browserStorage.ts`).
  assert.match(reader[0], /(?:readLocalStorage\(|localStorage\.getItem\()'is_vip'\) === 'true'/);

  // L'amont a déplacé l'extraction côté serveur : les gardes `if (!isVip)` de
  // `extractM3u8.ts` ont disparu au profit de `serverResolveRequest.ts`, qui
  // décide de la méthode. C'est LÀ que la clé compte désormais.
  assert.match(resolve, /export function usesServerExtraction\(\)/);
  assert.match(resolve, /if \(!isUserVip\(\)\) return false;/);

  // Les deux entrées s'amorcent ensemble, dans le bloc dev.
  const dev = main.match(/if \(import\.meta\.env\.DEV\) \{[\s\S]*?\n\}/);
  assert.ok(dev, 'bloc dev introuvable');
  assert.match(dev[0], /localStorage\.setItem\('access_code', devAccessCode\)/);
  assert.match(dev[0], /localStorage\.setItem\('is_vip', 'true'\)/);

  // Optimiste, jamais autoritaire : le contrôle serveur doit pouvoir retirer
  // ce que le bloc dev a posé, sinon une clé révoquée resterait VIP.
  assert.match(vip, /localStorage\.removeItem\('is_vip'\)/);
});

test('la barre pose le focus au lancement même si Chromium a focalisé la boîte qui défile', async () => {
  // Edenwood, WebView 154, 14/10/2026 : au lancement, Chromium donne le focus
  // au conteneur défilant ; pris pour un focus de la page, il laissait le
  // moteur sans position et la première flèche était perdue.
  const nav = await readFile(new URL('../components/TvTopNav.tsx', import.meta.url), 'utf8');
  assert.match(nav, /active\.matches\('button, a\[href\], input, textarea, select, \[tabindex\]'\)/);
});
