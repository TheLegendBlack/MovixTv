package com.movix.app.update

import android.app.DownloadManager
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.movix.app.BuildConfig
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * Pont natif pour le flow de mise à jour in-app.
 *
 * Expose :
 * - getVersionCode / getVersionName : lecture BuildConfig (comparaison avec manifest)
 * - getSupportedAbis : processeurs de l'appareil (choix de la variante d'APK)
 * - canInstallApks / openInstallSettings : permission "Sources inconnues"
 * - enqueueDownload / queryDownload / cancelDownload : wrapper DownloadManager
 * - computeSha256 : hash d'un fichier local (pour vérif avant install)
 * - installApk : Intent vers l'installer système via FileProvider
 */
class UpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UpdateModule"

    // --- Version info (from BuildConfig) ---------------------------------

    @ReactMethod
    fun getVersionCode(promise: Promise) {
        promise.resolve(BuildConfig.VERSION_CODE_INT)
    }

    @ReactMethod
    fun getVersionName(promise: Promise) {
        promise.resolve(BuildConfig.VERSION_NAME_STR)
    }

    /**
     * Processeurs de l'appareil, du préféré au moins bon (`Build.SUPPORTED_ABIS`) :
     * le manifeste de mise à jour propose une variante d'APK par processeur
     * (26/10/2026), la première connue de l'appareil est téléchargée.
     */
    @ReactMethod
    fun getSupportedAbis(promise: Promise) {
        val abis = Arguments.createArray()
        Build.SUPPORTED_ABIS.forEach { abis.pushString(it) }
        promise.resolve(abis)
    }

    // --- Install permission ----------------------------------------------

    @ReactMethod
    fun canInstallApks(promise: Promise) {
        try {
            // API 26+ gates APK installation behind a per-source user toggle.
            // On API 24-25, a declared REQUEST_INSTALL_PACKAGES permission is enough.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                promise.resolve(reactContext.packageManager.canRequestPackageInstalls())
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("PERM_CHECK_ERROR", e.message ?: "unknown", e)
        }
    }

    @ReactMethod
    fun openInstallSettings(promise: Promise) {
        try {
            // ACTION_MANAGE_UNKNOWN_APP_SOURCES was introduced in API 26. Before that,
            // there is no per-app setting to open: either REQUEST_INSTALL_PACKAGES is
            // already granted (we'd never reach here), or the user must toggle the
            // global "Unknown sources" switch manually.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                promise.reject("NOT_SUPPORTED", "Requires Android 8.0+")
                return
            }
            val intent = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:${reactContext.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("OPEN_SETTINGS_ERROR", e.message ?: "unknown", e)
        }
    }

    // --- Download (DownloadManager wrapper) -------------------------------

    @ReactMethod
    fun enqueueDownload(url: String, fileName: String, title: String, promise: Promise) {
        try {
            // Defense in depth: reject non-https URLs at the native boundary even though
            // the JS manifest validator also enforces this. A compromised/malformed
            // manifest must never be able to feed file:// or content:// here.
            val parsed = Uri.parse(url)
            if (parsed.scheme?.lowercase() != "https") {
                promise.reject("INVALID_URL", "Only https:// URLs are allowed")
                return
            }

            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val dir = reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?.canonicalFile
                ?: throw IllegalStateException("External files dir unavailable")
            if (!dir.exists()) dir.mkdirs()

            val target = File(dir, fileName).canonicalFile
            if (
                target.parentFile != dir ||
                !target.extension.equals("apk", ignoreCase = true)
            ) {
                promise.reject("INVALID_APK_PATH", "Invalid APK destination")
                return
            }
            if (target.exists()) target.delete() // avoid stale leftovers of same name

            val request = DownloadManager.Request(parsed)
                .setTitle(title)
                .setDescription("Téléchargement de la mise à jour Movix")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
                .setDestinationUri(Uri.fromFile(target))

            val id = dm.enqueue(request)
            val result = Arguments.createMap().apply {
                putDouble("downloadId", id.toDouble())
                putString("filePath", target.absolutePath)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ENQUEUE_ERROR", e.message ?: "unknown", e)
        }
    }

    @ReactMethod
    fun queryDownload(downloadId: Double, promise: Promise) {
        try {
            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val query = DownloadManager.Query().setFilterById(downloadId.toLong())
            val cursor: Cursor? = dm.query(query)
            if (cursor == null || !cursor.moveToFirst()) {
                cursor?.close()
                val result = Arguments.createMap().apply {
                    putString("status", "unknown")
                    putDouble("bytesDownloaded", 0.0)
                    putDouble("bytesTotal", 0.0)
                    putInt("reason", 0)
                }
                promise.resolve(result)
                return
            }

            val statusInt = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val downloaded = cursor.getLong(
                cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR),
            )
            val total = cursor.getLong(
                cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES),
            )
            val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
            cursor.close()

            val statusStr = when (statusInt) {
                DownloadManager.STATUS_PENDING -> "pending"
                DownloadManager.STATUS_RUNNING -> "running"
                DownloadManager.STATUS_PAUSED -> "paused"
                DownloadManager.STATUS_SUCCESSFUL -> "successful"
                DownloadManager.STATUS_FAILED -> "failed"
                else -> "unknown"
            }

            val result = Arguments.createMap().apply {
                putString("status", statusStr)
                putDouble("bytesDownloaded", downloaded.toDouble())
                putDouble("bytesTotal", total.toDouble())
                putInt("reason", reason)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("QUERY_ERROR", e.message ?: "unknown", e)
        }
    }

    @ReactMethod
    fun cancelDownload(downloadId: Double, promise: Promise) {
        try {
            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val removed = dm.remove(downloadId.toLong())
            promise.resolve(removed > 0)
        } catch (e: Exception) {
            promise.reject("CANCEL_ERROR", e.message ?: "unknown", e)
        }
    }

    // --- SHA256 ----------------------------------------------------------

    @ReactMethod
    fun computeSha256(filePath: String, promise: Promise) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "File does not exist")
                return
            }
            val md = MessageDigest.getInstance("SHA-256")
            FileInputStream(file).use { stream ->
                val buffer = ByteArray(8192)
                while (true) {
                    val read = stream.read(buffer)
                    if (read <= 0) break
                    md.update(buffer, 0, read)
                }
            }
            val hex = md.digest().joinToString("") { "%02x".format(it) }
            promise.resolve(hex)
        } catch (e: Exception) {
            promise.reject("SHA_ERROR", e.message ?: "unknown", e)
        }
    }

    // --- Install intent --------------------------------------------------

    @ReactMethod
    fun installApk(filePath: String, promise: Promise) {
        try {
            val updateDir = reactContext
                .getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?.canonicalFile
                ?: throw IllegalStateException("External files dir unavailable")
            val file = File(filePath).canonicalFile
            if (!file.exists() || !file.isFile) {
                promise.reject("FILE_NOT_FOUND", "APK file not found")
                return
            }
            if (
                file.parentFile != updateDir ||
                !file.extension.equals("apk", ignoreCase = true)
            ) {
                promise.reject("INVALID_APK_PATH", "Invalid APK path")
                return
            }

            val authority = "${reactContext.packageName}.updateprovider"
            val uri: Uri = FileProvider.getUriForFile(reactContext, authority, file)

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                clipData = ClipData.newRawUri("Movix update", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val installers = reactContext.packageManager.queryIntentActivities(
                intent,
                PackageManager.MATCH_DEFAULT_ONLY,
            )
            if (installers.isEmpty()) {
                promise.reject("NO_INSTALLER", "No package installer available")
                return
            }
            installers.forEach {
                reactContext.grantUriPermission(
                    it.activityInfo.packageName,
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }

            val activity = currentActivity
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                reactContext.startActivity(
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("INSTALL_ERROR", e.message ?: "unknown", e)
        }
    }
}
