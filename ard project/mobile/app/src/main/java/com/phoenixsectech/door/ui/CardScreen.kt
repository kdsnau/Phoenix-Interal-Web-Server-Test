package com.phoenixsectech.door.ui

import android.content.Context
import android.nfc.NfcAdapter
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Contactless
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.phoenixsectech.door.data.TokenRefresh
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

@Composable
fun CardScreen(vm: DoorViewModel) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val nfcOn = remember { nfcEnabled(context) }

    // ticking clock for the countdown
    var nowSec by remember { mutableStateOf(System.currentTimeMillis() / 1000) }
    LaunchedEffect(Unit) {
        while (isActive) { nowSec = System.currentTimeMillis() / 1000; delay(1000) }
    }

    // keep a fresh rotating token loaded into the HCE service while this screen is open
    LaunchedEffect(state.loggedIn) {
        if (!state.loggedIn) return@LaunchedEffect
        while (isActive) {
            val exp = try {
                vm.refreshTokenNow()
            } catch (e: Exception) {
                delay(10_000); continue
            }
            delay(TokenRefresh.nextDelayMs(exp))
        }
    }

    val secsLeft = (state.tokenExp - nowSec).coerceAtLeast(0)
    val ready = nfcOn && state.tokenExp > nowSec

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(16.dp))
        ElevatedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp)) {
                Text("ACCESS CARD", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(6.dp))
                Text(state.credential?.label ?: "Phone credential", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(4.dp))
                Text(
                    state.credential?.publicId ?: "—",
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        }

        Spacer(Modifier.height(40.dp))
        Box(
            Modifier.size(160.dp).clip(CircleShape)
                .background(if (ready) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Contactless, contentDescription = "Tap",
                tint = if (ready) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
                modifier = Modifier.size(84.dp),
            )
        }

        Spacer(Modifier.height(24.dp))
        when {
            state.credential == null -> StatusText("No phone credential issued yet. Ask an admin.", MaterialTheme.colorScheme.error)
            !nfcOn -> StatusText("Turn on NFC to use your phone as a card.", MaterialTheme.colorScheme.error)
            ready -> StatusText("Hold your phone to the reader.", MaterialTheme.colorScheme.primary)
            else -> StatusText("Preparing your card…", MaterialTheme.colorScheme.onSurface)
        }

        if (ready) {
            Spacer(Modifier.height(8.dp))
            Text("Refreshes in ${secsLeft}s", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
        }

        Spacer(Modifier.height(24.dp))
        OutlinedButton(onClick = { vm.refreshToken() }) { Text("Refresh now") }

        state.error?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun StatusText(text: String, color: Color) {
    Text(text, color = color, style = MaterialTheme.typography.bodyLarge)
}

private fun nfcEnabled(context: Context): Boolean =
    NfcAdapter.getDefaultAdapter(context)?.isEnabled == true
