package com.noteworthy.android.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.noteworthy.android.domain.model.ThemeMode

private val DarkColorScheme = darkColorScheme(
    primary = BrandDark,
    onPrimary = Paper0,
    primaryContainer = DarkSurface,
    onPrimaryContainer = DarkFg1,
    secondary = SpectrumSky,
    onSecondary = DarkCanvas,
    background = DarkCanvas,
    onBackground = DarkFg1,
    surface = DarkSurface,
    onSurface = DarkFg1,
    surfaceVariant = DarkSunken,
    onSurfaceVariant = DarkFg2,
    outline = DarkLine,
    outlineVariant = DarkLineSoft
)

private val LightColorScheme = lightColorScheme(
    primary = BrandLight,
    onPrimary = Paper0,
    primaryContainer = Paper2,
    onPrimaryContainer = Ink900,
    secondary = SpectrumCobalt,
    onSecondary = Paper0,
    background = Paper1,
    onBackground = Ink900,
    surface = Paper0,
    onSurface = Ink900,
    surfaceVariant = Paper2,
    onSurfaceVariant = Ink600,
    outline = Paper3,
    outlineVariant = Ink200
)

@Composable
fun NoteworthyTheme(
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    content: @Composable () -> Unit
) {
    val darkTheme = when (themeMode) {
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }

    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = NoteworthyTypography,
        shapes = NoteworthyShapes,
        content = content
    )
}
