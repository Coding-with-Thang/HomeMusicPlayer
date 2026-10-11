package expo.modules.audioroute

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val BECOMING_NOISY = "becomingNoisy"
private const val OUTPUT_CONNECTED = "outputConnected"
private const val OUTPUT_DISCONNECTED = "outputDisconnected"

class AudioRouteModule : Module() {
  private var noisyReceiver: BroadcastReceiver? = null
  private var deviceCallback: AudioDeviceCallback? = null

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  private val audioManager: AudioManager?
    get() = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("AudioRoute")

    Events(BECOMING_NOISY, OUTPUT_CONNECTED, OUTPUT_DISCONNECTED)

    OnStartObserving {
      startListening()
    }

    OnStopObserving {
      stopListening()
    }

    OnDestroy {
      stopListening()
    }
  }

  private fun startListening() {
    val context = context ?: return
    if (noisyReceiver == null) {
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
            sendEvent(BECOMING_NOISY, bundleOf())
          }
        }
      }
      ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
        ContextCompat.RECEIVER_NOT_EXPORTED
      )
      noisyReceiver = receiver
    }

    if (deviceCallback == null) {
      val callback = object : AudioDeviceCallback() {
        // Android replays already-connected devices on registration; skip that initial burst.
        private var isInitialReplay = true

        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
          if (isInitialReplay) {
            isInitialReplay = false
            return
          }
          addedDevices.firstNotNullOfOrNull(::describe)?.let {
            sendEvent(OUTPUT_CONNECTED, it)
          }
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
          removedDevices.firstNotNullOfOrNull(::describe)?.let {
            sendEvent(OUTPUT_DISCONNECTED, it)
          }
        }
      }
      audioManager?.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper()))
      deviceCallback = callback
    }
  }

  private fun stopListening() {
    val context = context
    noisyReceiver?.let { receiver ->
      try {
        context?.unregisterReceiver(receiver)
      } catch (_: IllegalArgumentException) {
        // Already unregistered.
      }
    }
    noisyReceiver = null
    deviceCallback?.let { audioManager?.unregisterAudioDeviceCallback(it) }
    deviceCallback = null
  }

  private fun describe(device: AudioDeviceInfo) =
    if (!device.isSink) {
      null
    } else {
      outputType(device.type)?.let { type ->
        bundleOf("name" to device.productName?.toString().orEmpty(), "type" to type)
      }
    }

  private fun outputType(type: Int): String? = when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER -> "bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
    else -> null
  }
}
