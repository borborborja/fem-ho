package ho.fem.app

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoSize
import ho.fem.model.ActivityNotificationKind

@Composable
internal fun NotificationSettingsHost(model: AppViewModel) {
    val state by model.notificationSettings.collectAsStateWithLifecycle()
    val revision by ActivityNotifications.changes.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val device = state.device
    var permission by remember { mutableStateOf(ActivityNotifications.showPermission(context)) }
    var requestedPermission by rememberSaveable { mutableStateOf(false) }
    var distributors by remember { mutableStateOf(emptyList<String>()) }
    var choosingDistributor by remember { mutableStateOf(false) }
    val requestPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        requestedPermission = true
        permission = granted
        if (granted) model.enableNotifications(true)
    }

    LaunchedEffect(revision) { model.loadNotificationSettings() }
    LifecycleResumeEffect(Unit) {
        permission = ActivityNotifications.showPermission(context)
        distributors = ActivityNotifications.distributors(context)
        model.loadNotificationSettings()
        onPauseOrDispose { }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.notify_activity_devicehelp),
            color = Femho.colors.inkSoft,
        )
        if (device == null && state.busy) {
            Text(stringResource(R.string.notify_activity_loading), color = Femho.colors.inkSoft)
        }
        if (device != null) {
            val status = when {
                device.enabled && device.subscribed -> R.string.notify_activity_subscribed
                device.enabled -> R.string.notify_activity_synconly
                else -> R.string.notify_activity_disabled
            }
            Text(stringResource(status), color = Femho.colors.ink)
            Button(
                onClick = {
                    when {
                        device.enabled -> model.enableNotifications(false)
                        permission -> model.enableNotifications(true)
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                            requestPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                },
                enabled = !state.busy && (device.enabled || permission || Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU),
                colors = ButtonDefaults.buttonColors(containerColor = Femho.colors.plouBlue, contentColor = Femho.onBrand),
                modifier = Modifier.testTag("notifications-device-toggle"),
            ) {
                Text(stringResource(if (device.enabled) R.string.notify_activity_disable else R.string.notify_activity_enable))
            }
        }

        if (!permission && (requestedPermission || device?.enabled == true ||
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU)
        ) {
            Text(stringResource(R.string.notify_activity_permissiondenied), color = Femho.colors.inkSoft)
        }
        TextButton(
            onClick = {
                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
            },
            colors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink),
        ) { Text(stringResource(R.string.notify_activity_systemsettings)) }
        if (device?.enabled == true && distributors.isNotEmpty()) {
            TextButton(
                enabled = !state.busy,
                onClick = { choosingDistributor = true },
                colors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink),
            ) { Text(stringResource(R.string.notify_activity_selectdistributor)) }
        }
        state.error?.let { error ->
            Text(stringResource(error), color = Femho.colors.dangerText)
            TextButton(
                onClick = model::loadNotificationSettings,
                colors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink),
                enabled = !state.busy,
            ) { Text(stringResource(R.string.error_retry)) }
        }
    }

    for (scope in device?.scopes.orEmpty()) key(scope.scopeId) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Femho.colors.ghostBg),
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text(scope.scopeName, color = Femho.colors.ink, fontWeight = FontWeight.Bold)
                for (kind in ActivityNotificationKind.entries) {
                    val checked = scope.enabled(kind)
                    val enabled = device?.enabled == true && !state.busy
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = FemhoSize.touch)
                            .toggleable(value = checked, enabled = enabled, role = Role.Switch) {
                                model.setScopeNotification(scope.scopeId, kind, it)
                            }
                            .testTag("notifications-${scope.scopeId}-${kind.wire}"),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(kind.label()), color = Femho.colors.ink)
                            if (kind == ActivityNotificationKind.INBOX_ENTRY) {
                                Text(stringResource(R.string.notify_activity_inboxhint), color = Femho.colors.inkSoft)
                            }
                        }
                        Switch(
                            checked = checked,
                            onCheckedChange = null,
                            enabled = enabled,
                            colors = SwitchDefaults.colors(checkedTrackColor = Femho.colors.plouBlue),
                        )
                    }
                }
            }
        }
    }

    if (choosingDistributor) AlertDialog(
        onDismissRequest = { choosingDistributor = false },
        title = { Text(stringResource(R.string.notify_activity_selectdistributor)) },
        text = {
            Column {
                for (distributor in distributors) {
                    val label = remember(distributor) {
                        runCatching {
                            val packages = context.packageManager
                            packages.getApplicationLabel(packages.getApplicationInfo(distributor, 0)).toString()
                        }.getOrDefault(distributor)
                    }
                    TextButton(onClick = {
                        choosingDistributor = false
                        model.chooseNotificationDistributor(distributor)
                    }) { Text(label) }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { choosingDistributor = false }) { Text(stringResource(R.string.nav_cancel)) }
        },
    )
}
