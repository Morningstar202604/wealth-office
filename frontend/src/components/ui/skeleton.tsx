import { cn } from "@/lib/utils";

/** 骨架屏（加载占位）。 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

/** 仪表盘骨架：统计卡 + 图表面板。 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-surface p-[var(--card-pad)]">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-24" />
            <Skeleton className="mt-1.5 h-3 w-14" />
          </div>
        ))}
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="card-surface p-[var(--card-pad)]">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-48 w-full" />
        </div>
        <div className="card-surface p-[var(--card-pad)]">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-48 w-full" />
        </div>
      </div>
    </div>
  );
}
