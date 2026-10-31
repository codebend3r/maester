package expo.modules.ravenaudio

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

/** Where a cover is: its address, and the headers its request carries. */
private class ArtworkSource(val uri: String, val headers: Map<String, String>)

private const val AUTHORITY_SUFFIX = ".ravenaudio.artwork"
private const val CACHE_FOLDER = "raven-artwork"
private const val FILE_SCHEME = "file"
private const val TIMEOUT_MS = 10_000

/** How many covers the provider knows at once: a few lists' worth. */
private const val SOURCES_KEPT = 512

/**
 * Hands Android Auto the browse tree's covers as `content://` addresses, the kind it loads:
 * a downloaded cover from its file, a server's fetched with the server's headers on the first
 * read and kept in the cache folder. Exported, since Auto reads it from its own process, but it
 * answers only the random keys `uriFor` gave out for covers the car was shown.
 */
class RavenArtworkProvider : ContentProvider() {
  companion object {
    private val lock = Any()
    private var sources: List<Pair<String, ArtworkSource>> = emptyList()

    /** The `content://` address Auto reads `artworkUri` from. */
    fun uriFor(context: Context, artworkUri: String, headers: Map<String, String>): Uri {
      val key = UUID.randomUUID().toString()
      synchronized(lock) {
        sources = (sources + (key to ArtworkSource(artworkUri, headers))).takeLast(SOURCES_KEPT)
      }
      return Uri.Builder()
        .scheme("content")
        .authority(context.packageName + AUTHORITY_SUFFIX)
        .appendPath(key)
        .build()
    }

    private fun sourceOf(key: String): ArtworkSource? =
      synchronized(lock) { sources.lastOrNull { it.first == key }?.second }
  }

  override fun onCreate() = true

  // Auto asks on one of the provider's binder threads, so the fetch blocks that alone, never a list.
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    val source = uri.lastPathSegment?.let(::sourceOf) ?: throw FileNotFoundException(uri.toString())
    val address = Uri.parse(source.uri)
    val file = if (address.scheme == FILE_SCHEME) {
      File(address.path ?: "")
    } else {
      // A provider may throw only this to its caller; a cover that cannot be fetched is missing.
      try {
        fetched(source)
      } catch (error: IOException) {
        throw FileNotFoundException(error.message)
      }
    }
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun fetched(source: ArtworkSource): File {
    val context = context ?: throw FileNotFoundException(source.uri)
    val folder = File(context.cacheDir, CACHE_FOLDER).apply { mkdirs() }
    val digest = MessageDigest.getInstance("SHA-256").digest(source.uri.toByteArray())
    val file = File(folder, digest.joinToString("") { "%02x".format(it) })
    if (file.exists()) return file
    val connection = URL(source.uri).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      source.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      if (connection.responseCode != HttpURLConnection.HTTP_OK) throw FileNotFoundException(source.uri)
      // Written beside its place and moved there once whole, so a cut fetch is never served.
      val part = File(folder, "${file.name}.part")
      connection.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
      part.renameTo(file)
      return file
    } finally {
      connection.disconnect()
    }
  }

  override fun getType(uri: Uri): String = "image/*"

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
