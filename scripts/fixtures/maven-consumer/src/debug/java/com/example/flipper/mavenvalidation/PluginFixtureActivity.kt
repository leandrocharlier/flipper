package com.example.flipper.mavenvalidation

import android.os.Bundle
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.compose.foundation.text.BasicText
import androidx.compose.ui.platform.ComposeView
import com.facebook.litho.ComponentContext
import com.facebook.litho.LithoView
import com.facebook.litho.widget.Text
import com.facebook.soloader.SoLoader
import com.facebook.flipper.android.AndroidFlipperClient
import com.facebook.flipper.plugins.network.NetworkFlipperPlugin

/** UI content owned entirely by the test, with no external data sources. */
class PluginFixtureActivity : ComponentActivity() {
  lateinit var composeView: ComposeView
  lateinit var lithoView: LithoView
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    if (intent.getBooleanExtra("desktopTest", false)) {
      SoLoader.init(this, false)
      val client = AndroidFlipperClient.getInstance(this)
      val network = NetworkFlipperPlugin()
      client.addPlugin(network)
      client.addPlugin(DesktopProbePlugin(network))
      client.start()
    }
    composeView = ComposeView(this).apply { setContent { BasicText("Synthetic Compose node") } }
    val componentContext = ComponentContext(this)
    lithoView = LithoView.create(this, Text.create(componentContext).text("Synthetic Litho node").build())
    setContentView(LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      addView(composeView)
      addView(lithoView)
    })
  }
}
