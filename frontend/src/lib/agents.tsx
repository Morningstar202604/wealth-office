import { Bot, Crown, FileText, LineChart, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react'

export const AGENT_ICON: Record<string, LucideIcon> = {
  supervisor: Crown,
  market: LineChart,
  ledger: Wallet,
  risk: ShieldCheck,
  finalize: FileText,
}

const TONE_TEXT: Record<string, string> = {
  blue: 'text-brand-blue',
  teal: 'text-brand-teal',
  green: 'text-brand-green',
  gold: 'text-brand-gold',
  purple: 'text-brand-purple',
}

export function toneTextClass(tone: string): string {
  return TONE_TEXT[tone] ?? 'text-foreground'
}

/** 分派路由的展示文案 */
export function routeLabel(route: string): string {
  return (
    { market: '行情分析员', ledger: '账本管家', both: '行情分析员 + 账本管家（并行）' }[route] ?? route
  )
}
