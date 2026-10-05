import { useEffect, useRef } from "react"
import { CandlestickSeries, createChart, HistogramSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts"
import type { ChartBar } from "../shared/contracts.mts"
import { localChartTime } from "./ChartTime.mts"

export function ChartView({ bars, symbol }: { bars: ChartBar[]; symbol: string }) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null)

  useEffect(() => {
    if (!host.current) return
    const localTime = localChartTime()
    const instance = createChart(host.current, {
    layout: { background: { color: "#f7faff" }, textColor: "#294569", fontFamily: "Inter, sans-serif", attributionLogo: true },
      grid: { vertLines: { color: "#dce8f7" }, horzLines: { color: "#dce8f7" } },
      rightPriceScale: { borderColor: "#c9dbf2" },
      timeScale: { borderColor: "#c9dbf2", timeVisible: true, secondsVisible: false, tickMarkFormatter: localTime.tickMarkFormatter },
      localization: { timeFormatter: localTime.timeFormatter },
      crosshair: { vertLine: { color: "#4388ed" }, horzLine: { color: "#4388ed" } },
    })
    const candleSeries = instance.addSeries(CandlestickSeries, {
      upColor: "#37c99a", downColor: "#e76672", borderVisible: false,
      wickUpColor: "#37c99a", wickDownColor: "#e76672",
    })
    const volumeSeries = instance.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "volume",
      priceLineVisible: false, lastValueVisible: false,
    })
    instance.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    chart.current = instance
    candles.current = candleSeries
    volume.current = volumeSeries

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) instance.resize(entry.contentRect.width, entry.contentRect.height)
    })
    resizeObserver.observe(host.current)
    return () => {
      resizeObserver.disconnect()
      instance.remove()
      chart.current = null
      candles.current = null
      volume.current = null
    }
  }, [])

  useEffect(() => {
    if (!chart.current || !candles.current || !volume.current) return
    const candleData = bars.map(({ time, open, high, low, close }) => ({ time: Math.floor(time / 1000) as UTCTimestamp, open, high, low, close }))
    const volumeData = bars.map(({ time, volume: value, close, open }) => ({
      time: Math.floor(time / 1000) as UTCTimestamp, value,
      color: close >= open ? "rgba(55, 201, 154, 0.42)" : "rgba(231, 102, 114, 0.42)",
    }))
    candles.current.setData(candleData)
    volume.current.setData(volumeData)
    chart.current.timeScale().fitContent()
  }, [bars, symbol])

  return <div className="chart-canvas" ref={host} role="img" aria-label={`${symbol} one-minute candlestick chart`} />
}
