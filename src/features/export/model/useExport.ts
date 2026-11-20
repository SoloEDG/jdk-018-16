import { useStudio } from "../../../shared/useStudio";
import { textContent } from "../lib/text";
import { download, exportName } from "../lib/download";
import { drawGrid, indexBitmap } from "../../preview";
import { encodeIndexedPng } from "../../palette";
export function useExport() {
  const { doc, notice, busy } = useStudio();
  function ready() {
    return doc.grid && doc.grid.revision === doc.revision && !busy.value;
  }
  function saveText() {
    if (!ready()) return;
    download(
      new Blob([textContent(doc.grid!)], { type: "text/plain;charset=utf-8" }),
      exportName(doc.asset?.name ?? "art", "txt"),
    );
    notice.value = "文本已导出";
  }
  async function copy() {
    if (!ready()) return;
    try {
      await navigator.clipboard.writeText(textContent(doc.grid!));
      notice.value = "字符画已复制";
    } catch {
      notice.value = "无法访问剪贴板，请使用文本导出";
    }
  }
  async function png() {
    if (!ready()) return;
    const grid = doc.grid!;
    if (doc.settings.indexed) {
      if (!grid.palette) throw new Error("索引色模式缺少色板，无法导出");
      // 校验：每个单元的 paletteId 必须落在色板导出索引内
      const maxIndex = grid.palette.entries.length - 1;
      for (const c of grid.cells) {
        if (c.paletteId < 0 || c.paletteId > maxIndex)
          throw new Error("存在未归并到色板的单元，导出已中止");
      }
      // 用与预览相同的绘制路径先渲染（保证视觉一致），但文件本身写索引 PNG
      drawGrid(
        document.createElement("canvas"),
        grid,
        doc.settings.color,
        doc.settings.background,
      );
      const blob = await encodeIndexedPng({
        width: grid.columns,
        height: grid.rows,
        indices: indexBitmap(grid),
        entries: grid.palette.entries,
      });
      download(blob, exportName(doc.asset?.name ?? "art", "png"));
      notice.value = `已导出索引色 PNG（${grid.palette.entries.length} 色，PLTE + tRNS）`;
      return;
    }
    const c = document.createElement("canvas");
    drawGrid(c, grid, doc.settings.color, doc.settings.background);
    c.toBlob((b) => {
      if (b) {
        download(b, exportName(doc.asset?.name ?? "art", "png"));
        notice.value = "已导出真彩色 PNG";
      }
    }, "image/png");
  }
  return { doc, busy, ready, saveText, copy, png };
}
