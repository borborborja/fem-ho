package ho.fem.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import ho.fem.designsystem.Femho
import ho.fem.model.MailAccount
import kotlinx.coroutines.launch

@Composable
fun MailPollingControl(model: AppViewModel, account: MailAccount) {
    var expanded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val defaultLabel = stringResource(R.string.settings_mail_polldefault)
    val minutesLabel = stringResource(R.string.settings_mail_pollminutes)
    fun label(seconds: Int?) = seconds?.let { minutesLabel.replace("{count}", (it / 60.0).toString().removeSuffix(".0")) } ?: defaultLabel
    Column {
        Text(stringResource(R.string.settings_mail_pollinterval), color = Femho.colors.ink)
        Box {
            TextButton(enabled = !busy, onClick = { expanded = true }) { Text(label(account.pollInterval)) }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                listOf(null, 60, 120, 300, 600, 900, 1800, 3600).forEach { seconds ->
                    DropdownMenuItem(text = { Text(label(seconds)) }, onClick = {
                        expanded = false; busy = true; failed = false
                        scope.launch {
                            runCatching { model.googleMailApi().setMailPollInterval(account.id, seconds) }
                                .onSuccess { model.loadMailData() }.onFailure { failed = true }
                            busy = false
                        }
                    })
                }
            }
        }
        Text(stringResource(R.string.settings_mail_pollhelp), color = Femho.colors.inkFaint)
        if (failed) Text(stringResource(R.string.error_generic), color = Femho.colors.dangerText)
    }
}
