package com.noteworthy.android

import android.app.PendingIntent
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The Note tile in Quick Settings. Pull the shade down over any app, tap
 * Note, and Write opens with the keyboard up. The shade is the quickest way
 * into an app that Android offers, quicker than finding the icon.
 *
 * The tile is an action, not a switch, so it never turns on. It sends the
 * same "go" the Write shortcut does (res/xml/shortcuts.xml), and MainActivity
 * does the rest: it opens Write once the page is ready, or straight away if
 * the app is already running.
 */
class NoteTileService : TileService() {

    // Called each time the shade shows the tile.
    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile ?: return
        tile.state = Tile.STATE_INACTIVE
        // Read aloud in place of "Note", which says what but not where.
        tile.contentDescription = getString(R.string.tile_note_description)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = getString(R.string.app_name)
        }
        tile.updateTile()
    }

    override fun onClick() {
        super.onClick()
        // A locked phone asks to be unlocked first and then opens Write, so
        // the tap is not spent on the lock screen.
        if (isLocked) unlockAndRun { openWrite() } else openWrite()
    }

    private fun openWrite() {
        val write = Intent(this, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(EXTRA_GO, "capture")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Its own identifier, so a PendingIntent made elsewhere in the app
            // for MainActivity, with a different "go", is never handed back
            // in its place (extras alone don't tell two apart).
            write.identifier = "tile:note"
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, write, PendingIntent.FLAG_IMMUTABLE))
        } else {
            // Android 14 replaced this with the PendingIntent form above, and
            // refuses it there. Below 14 it is the only form there is.
            @Suppress("DEPRECATION", "StartActivityAndCollapseDeprecated")
            startActivityAndCollapse(write)
        }
    }

    companion object {
        // MainActivity's name for the extra (EXTRA_GO), which it keeps to itself.
        private const val EXTRA_GO = "go"

        /**
         * Asks Android to add the Note tile to the shade, with a small sheet
         * of its own (Android 13 and later). Nothing calls it yet; Settings
         * can offer it. It only works while the app is on screen, and Android
         * may stop asking for a tile that has been turned down before.
         *
         * Returns false where Android can't ask. [done] hears whether the
         * tile is in the shade afterwards, added now or there already.
         */
        fun requestAdd(context: Context, done: (Boolean) -> Unit = {}): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
            val bar = context.getSystemService(StatusBarManager::class.java) ?: return false
            bar.requestAddTileService(
                ComponentName(context, NoteTileService::class.java),
                context.getString(R.string.tile_note),
                Icon.createWithResource(context, R.drawable.ic_tile_note),
                context.mainExecutor,
            ) { result ->
                done(
                    result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ||
                        result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED
                )
            }
            return true
        }
    }
}
