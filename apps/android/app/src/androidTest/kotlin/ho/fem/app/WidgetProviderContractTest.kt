package ho.fem.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.os.Build
import android.widget.FrameLayout
import android.widget.RemoteViews
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ho.fem.app.widget.BoardWidgetReceiver
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
}
