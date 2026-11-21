package ho.fem.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.content.res.Configuration
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.widget.FrameLayout
import android.widget.RemoteViews
import androidx.compose.ui.graphics.toArgb
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ho.fem.app.widget.BoardWidgetReceiver
import ho.fem.designsystem.FemhoAppearance
import ho.fem.widget.WidgetPalette
import ho.fem.widget.WidgetShape
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WidgetProviderContractTest {
    @Test
    fun tasksWidgetCanBePlacedBeforeConfiguration() {
        assumeTrue(Build.VERSION.SDK_INT >= 31)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val receiver = ComponentName(context, BoardWidgetReceiver::class.java)
        val info = AppWidgetManager.getInstance(context).installedProviders.single { it.provider == receiver }
        val expected = AppWidgetProviderInfo.WIDGET_FEATURE_CONFIGURATION_OPTIONAL or
            AppWidgetProviderInfo.WIDGET_FEATURE_RECONFIGURABLE
        assertEquals(expected, info.widgetFeatures and expected)
    }

    @Test
    fun boardPreviewCanBeInflatedAsRemoteViews() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.runOnMainSync {
            val remote = RemoteViews(context.packageName, R.layout.widget_task_board_preview)
            assertNotNull(remote.apply(context, FrameLayout(context)))
        }
    }

    @Test
    fun accessibleWidgetSurfacesUseTheSamePaletteAsTheirText() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val cases = listOf(
            WidgetPalette("system", "soft", FemhoAppearance.HIGH_CONTRAST),
            WidgetPalette("light", "soft", FemhoAppearance.HIGH_CONTRAST),
            WidgetPalette("dark", "soft", FemhoAppearance.HIGH_CONTRAST),
            WidgetPalette("dark", "mono-cool", FemhoAppearance.EINK),
        )
        for (systemDark in listOf(false, true)) {
            val config = Configuration(context.resources.configuration).apply {
                val night = if (systemDark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
                uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or night
            }
            val display = context.createConfigurationContext(config)
            for (palette in cases) {
                val dark = !palette.isEink && (palette.theme == "dark" || palette.theme == "system" && systemDark)
                val colors = if (dark) palette.dark else palette.light
                val surface = display.getDrawable(palette.drawable(WidgetShape.SURFACE)) as GradientDrawable
                assertEquals(colors.dialogBg.toArgb(), surface.color?.defaultColor)
                assertEquals(colors.ink.toArgb(), palette.color { ink }.getColor(display).toArgb())
            }
        }
    }
}
