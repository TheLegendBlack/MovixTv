package com.movix.app.adblock

/**
 * Liste d'hôtes publicitaires bloqués par le WebView (niveau 3 du plan
 * « sources à pubs »). Correspondance par suffixe de domaine : `popads.net`
 * couvre aussi `cdn.popads.net`. Les domaines Movix, le proxy média local et
 * les adresses privées ne sont jamais bloqués, quoi que contienne la liste.
 *
 * Régies et réseaux typiques des hébergeurs vidéo (pop-under, notifications
 * poussées, overlays), plus quelques mineurs de cryptomonnaie. Ajouter un
 * domaine ici, puis recompiler l'APK.
 */
object AdBlockList {
    private val ALLOW_SUFFIXES = listOf(
        "movix.men", "movix.fun", "movix.tax", "movix.app",
        "localhost", "127.0.0.1", "10.0.2.2",
    )

    val HOSTS: Set<String> = hashSetOf(
        // Pop-under / direct link
        "popads.net", "popcash.net", "popmyads.com", "popunder.net",
        "propellerads.com", "propellerclick.com", "onclickads.net", "onclicka.com",
        "onclickmega.com", "onclickperformance.com", "onclickalgo.com", "pemsrv.com",
        "monetag.com", "galaksion.com", "richads.com", "richpush.co", "push.house",
        "pushground.com", "notix.io", "pushame.com", "pushwhy.com",
        "adsterra.com", "highperformanceformat.com", "profitableratecpm.com",
        "effectivegatecpm.com", "displaycontentnetwork.com", "adsterra.net",
        "hilltopads.net", "hilltopads.com", "clickadu.com", "clickaine.com",
        "adcash.com", "a-ads.com", "adskeeper.com", "adskeeper.co.uk",
        "admaven.com", "ad-maven.com", "adnium.com", "adspyglass.com",
        "bidvertiser.com", "trafficstars.com", "tsyndicate.com", "adsco.re",
        "cpmstar.com", "plugrush.com", "adxpansion.com", "ero-advertising.com",
        "trafficfactory.biz", "tubecorporate.com", "zeropark.com",
        // Mesurés sur la TV (12/09/2026) dans les iframes Voe : ces domaines
        // tournent (deux mots anglais + .com) ; la vraie parade est la règle
        // « script tiers » de l'intercepteur, la liste ne fait que compléter.
        "pncloudfl.com", "spendsdetachment.com", "oblivioncertain.com",
        "portalfluently.com", "protrafficinspector.com", "ads-twitter.com",
        // SDK de publicités vidéo Google (pré-roll dans les lecteurs JW/Video.js)
        "imasdk.googleapis.com",
        // ExoClick / réseaux adultes présents sur les hébergeurs
        "exoclick.com", "exosrv.com", "exdynsrv.com", "realsrv.com", "magsrv.com",
        "trafficjunky.net", "trafficjunky.com", "juicyads.com", "juicyads.net",
        "adtng.com", "wpncdn.com",
        // Régies classiques
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "adservice.google.com", "adnxs.com", "criteo.com", "criteo.net",
        "rubiconproject.com", "pubmatic.com", "openx.net", "casalemedia.com",
        "smartadserver.com", "adform.net", "teads.tv", "sharethrough.com",
        "33across.com", "amazon-adsystem.com", "media.net", "adroll.com",
        "yieldmo.com", "spotxchange.com", "springserve.com", "undertone.com",
        "zedo.com", "zergnet.com", "engageya.com", "adtelligent.com",
        "mgid.com", "taboola.com", "outbrain.com", "revcontent.com",
        "adsafeprotected.com", "moatads.com", "doubleverify.com",
        "quantserve.com", "scorecardresearch.com", "bluekai.com", "everesttech.net",
        // Mineurs de cryptomonnaie
        "coinhive.com", "coin-hive.com", "crypto-loot.com", "cryptoloot.pro",
        "webminepool.com", "minero.cc", "jsecoin.com", "coinimp.com",
    )

    /**
     * Hôtes d'où un lecteur embarqué (ou le site Movix) a le droit de charger
     * un script même s'ils sont « tiers » : CDN de bibliothèques, lecteurs,
     * anti-robots. Tout autre script tiers dans une iframe est refusé — c'est
     * ce qui neutralise les régies à domaines tournants.
     */
    private val SCRIPT_CDN_SUFFIXES = listOf(
        "jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "code.jquery.com",
        "challenges.cloudflare.com", "static.cloudflareinsights.com",
        "gstatic.com", "ajax.googleapis.com", "fonts.googleapis.com", "google.com",
        "hcaptcha.com", "recaptcha.net",
        "jwpcdn.com", "jwpltx.com", "jwplayer.com", "vjs.zencdn.net",
        "cdn.plyr.io", "cdn.fluidplayer.com", "cdn.dashjs.org",
    )

    fun isScriptCdn(host: String): Boolean =
        SCRIPT_CDN_SUFFIXES.any { host == it || host.endsWith(".$it") }

    /**
     * « Marque » d'un hôte : le libellé juste avant le suffixe public —
     * `strm1.uqload.vc` → `uqload`, `x.example.co.uk` → `example`. Mesuré le
     * 12/09/2026 : Uqload sert son document depuis `uqload.is` et ses scripts
     * depuis `uqload.vc` ; comparer les eTLD+1 cassait le lecteur. Les régies
     * tournantes, elles, n'ont jamais la marque de l'hébergeur.
     */
    fun siteOf(host: String): String {
        val labels = host.split('.')
        if (labels.size <= 1) return host
        val secondLevel = labels[labels.size - 2]
        val takeThree = labels.size >= 3 && labels.last().length == 2 &&
            secondLevel in setOf("co", "com", "net", "org", "gov", "ac", "edu")
        return if (takeThree) labels[labels.size - 3] else secondLevel
    }

    /**
     * Hôtes du site que charge le shell, déclarés par `BrowserScreen` avant le
     * montage de la WebView (`AdBlockModule.trustSiteHost`). Sans eux, un site
     * servi hors des domaines Movix (Railway, 11/10/2026) passait pour une
     * iframe tierce : ses appels TMDB recevaient un 204 sans en-têtes CORS.
     */
    private val siteHosts = java.util.concurrent.CopyOnWriteArraySet<String>()

    fun trustSiteHost(host: String) {
        val h = host.trim().lowercase()
        if (h.isNotEmpty()) siteHosts.add(h)
    }

    fun isAllowed(host: String): Boolean {
        if (host in siteHosts) return true
        if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) return true
        return ALLOW_SUFFIXES.any { host == it || host.endsWith(".$it") }
    }

    /** Vrai si `host` ou l'un de ses domaines parents figure dans la liste. */
    fun isBlocked(host: String?): Boolean {
        if (host.isNullOrEmpty()) return false
        val h = host.lowercase()
        if (isAllowed(h)) return false
        var start = 0
        while (true) {
            if (h.substring(start) in HOSTS) return true
            val dot = h.indexOf('.', start)
            if (dot < 0) return false
            start = dot + 1
        }
    }
}
