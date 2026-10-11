package com.movix.app.proxy

import android.content.Context
import android.app.Application
import android.content.Intent
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class DiagnosticExportTest {
    @Test
    fun sharesLargeUtf8JournalAsReadableFileInsteadOfIntentText() {
        val context: Context = RuntimeEnvironment.getApplication()
        val report = "Échec du relais — diagnostic réseau\n".repeat(40_000)
        val intent = DiagnosticExport.createShareIntent(context, report)
        assertEquals(Intent.ACTION_SEND, intent.action)
        assertEquals("text/plain", intent.type)
        assertFalse(intent.hasExtra(Intent.EXTRA_TEXT))
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        @Suppress("DEPRECATION")
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)!!
        assertEquals("content", uri.scheme)
        assertEquals(uri, intent.clipData?.getItemAt(0)?.uri)
        assertEquals(report, context.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() })
    }
}
