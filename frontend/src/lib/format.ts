// 展示层格式化：金额 / 百分比 / 涨跌色（中国市场惯例：涨红跌绿）/ 大数缩写（万、亿）

/** 金额：v 为数字；signed 为真时正数加 "+"；compact 为真时 ≥1万 缩写为万/亿。 */
export function fmtMoney(v: number | undefined | null, signed = false, compact = false): string {
  if (v == null || Number.isNaN(v)) return "-";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : signed ? "+" : "";
  let body: string;
  if (compact && abs >= 1e8) {
    body = `${(abs / 1e8).toFixed(2)}亿`;
  } else if (compact && abs >= 1e4) {
    body = `${(abs / 1e4).toFixed(1)}万`;
  } else {
    body = abs.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  return `${sign}¥${body}`;
}

export function fmtPct(v: number | undefined | null, withSign = false): string {
  if (v == null || Number.isNaN(v)) return "-";
  const sign = v < 0 ? "" : withSign ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

/** 红涨绿跌：正值红（涨/盈），负值绿（跌/亏） */
export function pnlClass(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v) || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-up" : "text-down";
}

export function pnlBgClass(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v) || v === 0) return "";
  return v > 0 ? "bg-up/10 text-up" : "bg-down/10 text-down";
}

/** 日期友好显示 */
export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** 月份显示：2026-09 -> 2026年9月 */
export function fmtMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}
