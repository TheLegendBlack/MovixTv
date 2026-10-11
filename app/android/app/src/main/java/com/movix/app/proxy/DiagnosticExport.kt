package com.movix.app.proxy

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

internal object DiagnosticExport {
    fun createShareIntent(context: Context, text: String): Intent {
        val bytes = text.toByteArray(Charsets.UTF_8)
        require(bytes.size <= 8 * 1024 * 1024)
        val directory = File(context.cacheDir, "diagnostics").apply { mkdirs() }
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        directory.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }
            ?.forEach { it.delete() }
        val file = File(directory, "movix-diagnostic-${UUID.randomUUID()}.txt")
        file.writeBytes(bytes)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updateprovider", file)
        return Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri("Diagnostic Movix", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}
