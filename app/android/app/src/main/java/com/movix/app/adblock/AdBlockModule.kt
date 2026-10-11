package com.movix.app.adblock

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Pont JS du bloqueur : réglage marche/arrêt, compteur, liste d'hôtes. */
class AdBlockModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MovixAdBlock"

    // La liste est exposée en constante pour que le JS puisse refuser, de
    // façon synchrone, une navigation ou une pop-up vers un hôte bloqué.
    override fun getConstants(): Map<String, Any> = mapOf(
        "blockedHosts" to AdBlockList.HOSTS.toList().sorted(),
    )

    @ReactMethod
    fun setEnabled(enabled: Boolean, promise: Promise) {
        AdBlockInterceptor.setEnabled(enabled)
        promise.resolve(enabled)
    }

    @ReactMethod
    fun isEnabled(promise: Promise) {
        promise.resolve(AdBlockInterceptor.enabled)
    }

    @ReactMethod
    fun getStats(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("enabled", AdBlockInterceptor.enabled)
        map.putInt("blocked", AdBlockInterceptor.blockedTotal())
        val recent = Arguments.createArray()
        AdBlockInterceptor.recentHosts().forEach { recent.pushString(it) }
        map.putArray("recent", recent)
        promise.resolve(map)
    }

    /**
     * Déclare l'hôte du site chargé. Synchrone : `BrowserScreen` l'appelle avant
     * de monter la WebView, pour que la première requête de la page soit déjà
     * jugée comme celle du site et non d'une iframe tierce.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun trustSiteHost(host: String): Boolean {
        AdBlockList.trustSiteHost(host)
        return true
    }

    @ReactMethod
    fun resetStats(promise: Promise) {
        AdBlockInterceptor.resetStats()
        promise.resolve(true)
    }
}
