package com.movix.app.proxy

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MediaProxyJournalTest {
    @Test
    fun disablingCaptureDiscardsAnEntryAlreadyBeingFormatted() = pendingEntryIsDiscarded {
        MediaProxyJournal.setEnabled(false)
    }

    @Test
    fun clearingCaptureDiscardsAnEntryFromThePreviousGeneration() = pendingEntryIsDiscarded {
        MediaProxyJournal.clear()
    }

    @Test
    fun restartingCaptureDoesNotRestoreEntriesFromThePreviousCapture() = pendingEntryIsDiscarded {
        MediaProxyJournal.setEnabled(false)
        MediaProxyJournal.setEnabled(true)
    }

    private fun pendingEntryIsDiscarded(reset: () -> Unit) {
        val formatting = CountDownLatch(1)
        val resume = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        val headers = object : AbstractMap<String, String>() {
            override val entries: Set<Map.Entry<String, String>>
                get() {
                    formatting.countDown()
                    check(resume.await(5, TimeUnit.SECONDS))
                    return mapOf("Cookie" to "private-session").entries
                }
        }
        MediaProxyJournal.clear()
        MediaProxyJournal.setEnabled(true)
        try {
            val recording = executor.submit {
                MediaProxyJournal.record("test", "GET", "https://example.com", headers)
            }
            assertTrue(formatting.await(5, TimeUnit.SECONDS))
            reset()
            resume.countDown()
            recording.get(5, TimeUnit.SECONDS)
            assertTrue(MediaProxyJournal.snapshot().isEmpty())
        } finally {
            resume.countDown()
            executor.shutdownNow()
            MediaProxyJournal.setEnabled(false)
        }
    }
}
