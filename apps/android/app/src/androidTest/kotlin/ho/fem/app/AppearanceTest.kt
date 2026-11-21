package ho.fem.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoAppearance
import ho.fem.designsystem.FemhoTheme
import ho.fem.designsystem.femhoDarkTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppearanceTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun einkStaysLightAndMaterialComponentsUseMonochromeColors() {
        assertTrue(femhoDarkTheme("system", FemhoAppearance.HIGH_CONTRAST, systemDark = true))
        assertFalse(femhoDarkTheme("system", FemhoAppearance.HIGH_CONTRAST, systemDark = false))
        assertFalse(femhoDarkTheme("dark", FemhoAppearance.EINK, systemDark = true))
        var componentColors = emptyList<Color>()
        compose.setContent {
            FemhoTheme("dark", "mono-cool", FemhoAppearance.EINK) {
                val colors = MaterialTheme.colorScheme
                componentColors = listOf(
                    Femho.colors.ink, Femho.colors.panelBg, colors.primary, colors.secondaryContainer,
                    colors.surfaceContainerHigh, colors.error, colors.errorContainer,
                )
            }
        }
        compose.runOnIdle {
            assertEquals(7, componentColors.size)
            assertTrue(componentColors.all { it.red == it.green && it.green == it.blue })
        }
    }

    @Test
    fun einkPomodoroWakesOnDisplayedBoundaries() {
        assertEquals(60_000L, einkPomodoroDelay(120_000))
        assertEquals(1L, einkPomodoroDelay(60_001))
        assertEquals(1_000L, einkPomodoroDelay(60_000))
        assertEquals(21L, einkPomodoroDelay(21))
    }
}
