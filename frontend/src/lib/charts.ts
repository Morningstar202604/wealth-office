/** ECharts 按需注册 + 轻量挂载 hook（深度副作用导入，避免整包打入）。 */

import { useEffect, type RefObject } from "react";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
// 以下深度模块为副作用注册（各自 install 到 core），不要改回 barrel 导入
import "echarts/lib/chart/bar";
import "echarts/lib/chart/pie";
import "echarts/lib/component/grid";
import "echarts/lib/component/legend";
import "echarts/lib/component/tooltip";

echarts.use([CanvasRenderer]);

/** 把 option 挂到容器上，容器尺寸变化自动 resize。 */
export function useEChart(
  ref: RefObject<HTMLDivElement | null>,
  option: echarts.EChartsCoreOption | null,
  deps: unknown[],
): void {
  useEffect(() => {
    if (!ref.current || !option) return;
    const chart = echarts.init(ref.current);
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const PALETTE = [
  "#2f6fed", "#0ea5a4", "#16a34a", "#d97706", "#7c5cd6",
  "#e11d48", "#0891b2", "#65a30d", "#9333ea", "#64748b",
];
