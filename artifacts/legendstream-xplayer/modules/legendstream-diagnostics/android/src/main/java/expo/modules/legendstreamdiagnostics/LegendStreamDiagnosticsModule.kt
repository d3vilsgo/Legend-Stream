package expo.modules.legendstreamdiagnostics

import android.os.Debug
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class LegendStreamDiagnosticsModule : Module() {
  private val lock = Any()
  private val sampler = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "legendstream-memory-sampler").apply { isDaemon = true }
  }
  private var samplingTask: ScheduledFuture<*>? = null
  private var generation = 0
  private var phase = "idle"
  private var sampleCount = 0
  private var kdfPeakPssKb = 0
  private var commitPeakPssKb = 0
  private var decisionPeakPssKb = 0

  // totalPss covers Java, native and graphics allocations attributed to this
  // process. Sampling stays off the JS/UI threads and is intentionally limited
  // to 4 Hz so the measurement does not become the import bottleneck itself.
  private fun sampleMemory(expectedGeneration: Int) {
    val memoryInfo = Debug.MemoryInfo()
    Debug.getMemoryInfo(memoryInfo)
    synchronized(lock) {
      if (expectedGeneration != generation) return
      sampleCount += 1
      if (phase == "decision") {
        decisionPeakPssKb = maxOf(decisionPeakPssKb, memoryInfo.totalPss)
      } else if (phase == "kdf") {
        kdfPeakPssKb = maxOf(kdfPeakPssKb, memoryInfo.totalPss)
      } else if (phase == "commit") {
        commitPeakPssKb = maxOf(commitPeakPssKb, memoryInfo.totalPss)
      }
    }
  }

  private fun resetSampler(initialPhase: String) {
    synchronized(lock) {
      samplingTask?.cancel(false)
      phase = initialPhase
      sampleCount = 0
      kdfPeakPssKb = 0
      commitPeakPssKb = 0
      decisionPeakPssKb = 0
      generation += 1
      val currentGeneration = generation
      samplingTask = sampler.scheduleAtFixedRate(
        { sampleMemory(currentGeneration) },
        0,
        250,
        TimeUnit.MILLISECONDS
      )
    }
  }

  private fun setSamplerPhase(nextPhase: String): Boolean {
    if (nextPhase != "kdf" && nextPhase != "decision" && nextPhase != "commit") {
      return false
    }
    val currentGeneration = synchronized(lock) {
      if (samplingTask == null) return false
      phase = nextPhase
      generation
    }
    sampleMemory(currentGeneration)
    return true
  }

  private fun stopSampler(): Map<String, Any> {
    val currentGeneration = synchronized(lock) { generation }
    sampleMemory(currentGeneration)
    synchronized(lock) {
      samplingTask?.cancel(false)
      samplingTask = null
      phase = "idle"
      val result = mapOf(
        "available" to true,
        "processingPeakPssKb" to maxOf(kdfPeakPssKb, commitPeakPssKb),
        "kdfPeakPssKb" to kdfPeakPssKb,
        "commitPeakPssKb" to commitPeakPssKb,
        "decisionPeakPssKb" to decisionPeakPssKb,
        "sampleCount" to sampleCount,
        "sampleIntervalMs" to 250
      )
      generation += 1
      return result
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LegendStreamDiagnostics")

    Function("startImportMemorySampling") {
      resetSampler("kdf")
      true
    }

    Function("setImportMemoryPhase") { nextPhase: String ->
      setSamplerPhase(nextPhase)
    }

    Function("stopImportMemorySampling") {
      stopSampler()
    }
  }
}
