package ho.fem.app.widget

import androidx.compose.ui.graphics.Color
import ho.fem.app.R
import ho.fem.designsystem.FemhoColors
import ho.fem.model.TaskStatus

/**
 * Les quatre columnes, amb el seu nom i el seu to.
 *
 * **El to surt de la tríada de l'accent** (`plouBlue`, `plouOrange`, `plouPink`), que és
 * la que canvia quan algú tria un accent a Ajustos. Si els colors s'escrivissin aquí, el
 * widget seria l'única superfície del producte que no obeeix aquella preferència.
 *
 * L'ordre és el del tauler i no l'alfabètic: bústia, per fer, fent, fet.
 */
data class BoardColumn(
    val status: TaskStatus,
    val label: Int,
    val tint: FemhoColors.() -> Color,
)

val COLUMNS = listOf(
    BoardColumn(TaskStatus.INBOX, R.string.board_column_inbox) { inkSoft },
    BoardColumn(TaskStatus.TODO, R.string.board_column_todo) { plouBlue },
    BoardColumn(TaskStatus.DOING, R.string.board_column_doing) { plouOrange },
    BoardColumn(TaskStatus.DONE, R.string.board_column_done) { plouPink },
)
