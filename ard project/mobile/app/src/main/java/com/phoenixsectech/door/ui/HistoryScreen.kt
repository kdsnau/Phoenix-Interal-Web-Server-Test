package com.phoenixsectech.door.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.phoenixsectech.door.data.EventDto

@Composable
fun HistoryScreen(vm: DoorViewModel) {
    val state by vm.state.collectAsState()
    LaunchedEffect(Unit) { vm.loadEvents() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Recent taps", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        if (state.events.isEmpty()) {
            Text("No taps yet.", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.events) { EventRow(it) }
            }
        }
    }
}

@Composable
private fun EventRow(e: EventDto) {
    val granted = e.decision == "granted"
    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(e.doorName ?: "Unknown door", style = MaterialTheme.typography.bodyLarge)
                Text(
                    "${e.scannedAt}${e.reason?.let { " · $it" } ?: ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
            AssistChip(
                onClick = {},
                label = { Text(if (granted) "granted" else "denied") },
                colors = AssistChipDefaults.assistChipColors(
                    labelColor = if (granted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                ),
            )
        }
    }
}
