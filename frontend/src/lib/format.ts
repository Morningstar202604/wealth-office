// 展示层格式化：金额 / 百分比 / 涨跌色（中国市场惯例：涨红跌绿）

export function fmtMoney(v: number | undefined | null, withSign = false): string {
  if (v == null || Number.isNaN(v)) return '-'
  const abs = Math.abs(v)
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const sign = v < 0 ? '-' : withSign && v > 0 ? '+' : ''
  return `${sign}¥${s}`
}

export function fmtPct(v: number | undefined | null, withSign = false): string {
  if (v == null || Number.isNaN(v)) return '-'
  const sign = v < 0 ? '' : withSign ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

/** 红涨绿跌：正值红（涨/盈），负值绿（跌/亏） */
export function pnlClass(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v) || v === 0) return 'text-muted-foreground'
  return v > 0 ? 'text-red-600' : 'text-emerald-600'
}

export function pnlBgClass(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v) || v === 0) return ''
  return v > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
}
