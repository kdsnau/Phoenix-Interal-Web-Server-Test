package com.phoenixsectech.door.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFF6A3D),
    secondary = Color(0xFFFFA14A),
    background = Color(0xFF0E1116),
    surface = Color(0xFF171C24),
    surfaceVariant = Color(0xFF1F262F),
    onPrimary = Color(0xFF1A0F0A),
    onBackground = Color(0xFFE6E9EE),
    onSurface = Color(0xFFE6E9EE),
    error = Color(0xFFEF4D5A),
)

@Composable
fun PhxDoorTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkColors, content = content)
}
