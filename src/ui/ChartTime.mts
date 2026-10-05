import { TickMarkType, type Time } from "lightweight-charts"

export function localChartTime(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, locale?: string) {
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone })
  const hours = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const
  const ticks = {
    [TickMarkType.Year]: format({ year: "numeric" }),
    [TickMarkType.Month]: format({ month: "short" }),
    [TickMarkType.DayOfMonth]: format({ day: "numeric" }),
    [TickMarkType.Time]: format(hours),
    [TickMarkType.TimeWithSeconds]: format({ ...hours, second: "2-digit" }),
  }
  const hover = format({ month: "short", day: "numeric", ...hours, timeZoneName: "short" })
  return {
    timeZone,
    tickMarkFormatter: (time: Time, type: TickMarkType): string | null =>
      typeof time === "number" ? ticks[type].format(new Date(time * 1000)) : null,
    timeFormatter: (time: Time): string => {
      if (typeof time === "number") return hover.format(new Date(time * 1000))
      if (typeof time === "string") return time
      return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`
    },
  }
}
