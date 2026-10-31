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

/** Where a cover is: its address, and the headers its request carries. */
private class ArtworkSource(val uri: String, val headers: Map<String, String>)

private const val AUTHORITY_SUFFIX = ".ravenaudio.artwork"
private const val CACHE_FOLDER = "raven-artwork"
private const val FILE_SCHEME = "file"
private const val PART_SUFFIX = ".part"
private const val TIMEOUT_MS = 10_000

/** How many covers the provider knows at once: a few lists' worth. */
private const val SOURCES_KEPT = 512

/** The cache folder's bounds; past either, the covers read longest ago go first. */
private const val CACHE_FILES_KEPT = 200
private const val CACHE_BYTES_KEPT = 50L * 1024 * 1024

/** A cover's key: a stable hash of its address, so a list shown again names the same keys. */
private fun keyOf(artworkUri: String): String =
  MessageDigest.getInstance("SHA-256").digest(artworkUri.toByteArray()).joinToString("") { "%02x".format(it) }

/**
 * Hands Android Auto the browse tree's covers as `content://` addresses, the kind it loads:
 * a downloaded cover from its file, a server's fetched with the server's headers on the first
 * read and kept in the cache folder, trimmed to its bounds by last read. Exported, since Auto
 * reads it from its own process, but it answers only the keys `uriFor` gave out for covers the
 * car was shown.
 */
class RavenArtworkProvider : ContentProvider() {
  companion object {
    private val lock = Any()
    private var sources: Map<String, ArtworkSource> = emptyMap()

    /**
     * The `content://` address Auto reads `artworkUri` from. Null `headers` keep those the
     * cover was last shown with: a node named alone carries none of its own.
     */
    fun uriFor(context: Context, artworkUri: String, headers: Map<String, String>?): Uri {
      val key = keyOf(artworkUri)
      synchronized(lock) {
        val kept = sources[key]?.headers ?: emptyMap()
        val source = ArtworkSource(artworkUri, headers ?: kept)
        sources = (sources - key + (key to source)).entries.toList().takeLast(SOURCES_KEPT).associate { it.toPair() }
      }
      return Uri.Builder()
        .scheme("content")
        .authority(context.packageName + AUTHORITY_SUFFIX)
        .appendPath(key)
        .build()
    }

    private fun sourceOf(key: String): ArtworkSource? = synchronized(lock) { sources[key] }
  }

  override fun onCreate() = true

  // Auto asks on one of the provider's binder threads, so the fetch blocks that alone, never a list.
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    val key = uri.lastPathSegment ?: throw FileNotFoundException(uri.toString())
    val source = sourceOf(key) ?: throw FileNotFoundException(uri.toString())
    val address = Uri.parse(source.uri)
    val file = if (address.scheme == FILE_SCHEME) {
      File(address.path ?: "")
    } else {
      // A provider may throw only this to its caller; a cover that cannot be fetched is missing.
      try {
        fetched(key, source)
      } catch (error: IOException) {
        throw FileNotFoundException(error.message)
      }
    }
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun fetched(key: String, source: ArtworkSource): File {
    val context = context ?: throw FileNotFoundException(source.uri)
    val folder = File(context.cacheDir, CACHE_FOLDER).apply { mkdirs() }
    val file = File(folder, key)
    if (file.exists()) {
      file.setLastModified(System.currentTimeMillis())
      return file
    }
    val connection = URL(source.uri).openConnection() as? HttpURLConnection
      ?: throw FileNotFoundException(source.uri)
    // Each fetch writes a part of its own and moves it into place once whole, so a cut fetch is
    // never served and two fetches of one cover never write into one file.
    val part = File.createTempFile(key, PART_SUFFIX, folder)
    try {
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      source.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      if (connection.responseCode != HttpURLConnection.HTTP_OK) throw FileNotFoundException(source.uri)
      connection.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
      if (!part.renameTo(file) && !file.exists()) throw FileNotFoundException(source.uri)
    } finally {
      part.delete()
      connection.disconnect()
    }
    trim(folder)
    return file
  }

  private fun trim(folder: File) {
    val covers = folder.listFiles { each -> !each.name.endsWith(PART_SUFFIX) }.orEmpty().sortedByDescending { it.lastModified() }
    val kept = covers.runningFold(0L) { total, each -> total + each.length() }.drop(1)
    covers.zip(kept).forEachIndexed { place, (cover, bytes) ->
      if (place >= CACHE_FILES_KEPT || bytes > CACHE_BYTES_KEPT) cover.delete()
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
