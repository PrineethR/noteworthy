package com.noteworthy.android

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import android.util.SizeF
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Calendar

/**
 * The Write widget: a line to write on, and a mic.
 *
 * The home screen is one more place to write, so the widget keeps the rule
 * of the app's own home: nothing to count. One row tall it is just the strip.
 * Two rows add the date and a greeting, as the app's home has them, but
 * without a name, since the widget can't know who is signed in.
 *
 * Tapping the line opens the app on Write with the keyboard up, the same way
 * the Write shortcut does: MainActivity reads the "go" extra. The mic adds
 * then=voice, so the app starts listening once Write is open.
 */
class WriteWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, viewsFor(context, manager.getAppWidgetOptions(id)))
    }

    // From Android 12 the launcher picks between the layouts as the widget
    // is resized. Before that the widget picks, so it has to be asked again.
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) manager.updateAppWidget(id, viewsFor(context, options))
    }

    // The date is written in the phone's language and time zone, so a change
    // to either redraws it now rather than at the next half-hourly update.
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action !in CLOCK_CHANGES) return
        val manager = AppWidgetManager.getInstance(context)
        onUpdate(context, manager, manager.getAppWidgetIds(ComponentName(context, WriteWidget::class.java)))
    }

    private fun viewsFor(context: Context, options: Bundle): RemoteViews {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Each layout is mapped to the least height it needs, at any width.
            return RemoteViews(mapOf(
                SizeF(0f, 0f) to strip(context),
                SizeF(0f, TALL_DP.toFloat()) to tall(context),
            ))
        }
        // A launcher reports the portrait size as the narrowest width and the
        // greatest height, and landscape the other way round.
        val portrait = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) >= TALL_DP
        val landscape = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) >= TALL_DP
        return when {
            portrait == landscape -> if (portrait) tall(context) else strip(context)
            portrait -> RemoteViews(strip(context), tall(context))
            else -> RemoteViews(tall(context), strip(context))
        }
    }

    // One row: the strip, which is the widget's background.
    private fun strip(context: Context) =
        RemoteViews(context.packageName, R.layout.widget_write).apply {
            setOnClickPendingIntent(android.R.id.background, open(context, voice = false))
            setOnClickPendingIntent(R.id.widget_write_mic, open(context, voice = true))
        }

    // Two rows: the date and the greeting over the strip. The whole card writes.
    private fun tall(context: Context): RemoteViews {
        val now = Calendar.getInstance()
        val locale = context.resources.configuration.locales[0]
        // "Saturday 24 October" in Britain, "Saturday, October 24" in America.
        val date = SimpleDateFormat(DateFormat.getBestDateTimePattern(locale, "EEEEdMMMM"), locale)
        return RemoteViews(context.packageName, R.layout.widget_write_tall).apply {
            setTextViewText(R.id.widget_write_date, date.format(now.time))
            setTextViewText(R.id.widget_write_greeting, context.getString(greeting(now.get(Calendar.HOUR_OF_DAY))))
            setOnClickPendingIntent(android.R.id.background, open(context, voice = false))
            setOnClickPendingIntent(R.id.widget_write_mic, open(context, voice = true))
        }
    }

    // The same hours as the app's home (story.js, partOfDay).
    private fun greeting(hour: Int) = when {
        hour < 5 -> R.string.widget_write_night
        hour < 12 -> R.string.widget_write_morning
        hour < 17 -> R.string.widget_write_afternoon
        hour < 22 -> R.string.widget_write_evening
        else -> R.string.widget_write_night
    }

    /**
     * Opens the app on Write, or on Write listening. The two differ only in
     * an extra, which doesn't tell PendingIntents apart, so each has its own
     * request code; otherwise the second would take the first's place and
     * both taps would do the same thing.
     */
    private fun open(context: Context, voice: Boolean): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_GO, "capture")
        if (voice) intent.putExtra(EXTRA_THEN, "voice")
        return PendingIntent.getActivity(
            context,
            if (voice) REQUEST_SPEAK else REQUEST_WRITE,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    private companion object {
        // MainActivity's extras: the chapter to open, and what to do there.
        const val EXTRA_GO = "go"
        const val EXTRA_THEN = "then"
        // Kept clear of any other PendingIntent the app makes for MainActivity.
        const val REQUEST_WRITE = 0x5701
        const val REQUEST_SPEAK = 0x5702
        // The height, in dp, the date and greeting need above the strip. A
        // row is about 100 to 150dp tall on a phone, so two rows clear it
        // and one never does.
        const val TALL_DP = 160
        val CLOCK_CHANGES = setOf(
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_LOCALE_CHANGED,
        )
    }
}
