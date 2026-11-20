<script setup lang="ts">
import { computed } from "vue";
import { Code2, Scan, Minus, Plus, MousePointerClick } from "lucide-vue-next";
import { usePreview } from "../model/usePreview";
import { usePaletteSession } from "../../palette";
import { gridRows } from "../lib/rows";
import ArtCanvas from "./ArtCanvas.vue";
const p = usePreview();
const palette = usePaletteSession();
const text = computed(() =>
  p.doc.grid ? gridRows(p.doc.grid).join("\n") : "",
);

function onCellClick(payload: { cellIndex: number; paletteId: number }) {
  if (palette.eyedropper.value) {
    // 吸色取该单元的原始采样色，而不是归并后的色板色
    const hex = palette.sampleCellColor(payload.cellIndex);
    if (hex) {
      palette.addLock(hex, "eyedropper");
      palette.eyedropper.value = false;
    }
    return;
  }
  palette.track(payload.paletteId);
}

const trackedEntry = computed(() => {
  if (palette.trackedIndex.value === null || !p.doc.grid?.palette) return null;
  return (
    p.doc.grid.palette.entries.find(
      (e) => e.index === palette.trackedIndex.value,
    ) ?? null
  );
});
</script>
<template>
  <main class="workspace">
    <div class="preview-toolbar">
      <div class="tabs">
        <button
          :class="{ active: p.mode.value === 'art' }"
          @click="p.mode.value = 'art'"
        >
          <Scan :size="14" /> 字符预览</button
        ><button
          :class="{ active: p.mode.value === 'text' }"
          @click="p.mode.value = 'text'"
        >
          <Code2 :size="14" /> 纯文本
        </button>
      </div>
      <div class="toolbar-toggles">
        <label class="color-toggle"
          ><span class="palette-dot" /> 索引色<input
            aria-label="索引色模式"
            type="checkbox"
            v-model="p.doc.settings.indexed"
            @change="p.invalidate"
        /></label>
        <label class="color-toggle"
          ><span class="color-dot" /> 彩色<input
            aria-label="彩色预览"
            type="checkbox"
            v-model="p.doc.settings.color"
        /></label>
      </div>
    </div>
    <div class="art-stage">
      <div class="stage-label">OUTPUT / LIVE RENDER <span>●</span></div>
      <div class="art-scroll">
        <ArtCanvas
          v-if="p.doc.grid && p.mode.value === 'art'"
          :grid="p.doc.grid"
          :color="p.doc.settings.color"
          :background="p.doc.settings.background"
          :zoom="p.zoom.value"
          :track-id="p.doc.settings.indexed ? palette.trackedIndex.value : null"
          @cell-click="onCellClick"
        />
        <pre
          v-else-if="p.doc.grid"
          data-testid="text-preview"
          :style="{
            fontSize: (14 * p.zoom.value) / 100 + 'px',
            lineHeight: (16 * p.zoom.value) / 100 + 'px',
          }"
          >{{ text }}</pre
        >
        <span v-else>正在准备字符画…</span>
      </div>
      <div class="stage-corner">
        {{ p.doc.grid?.columns }} COL × {{ p.doc.grid?.rows }} ROW
      </div>
    </div>
    <div
      v-if="trackedEntry"
      class="track-bar"
      @click="palette.track(null)"
      role="button"
    >
      <MousePointerClick :size="13" />
      <span
        class="track-swatch"
        :style="{
          background:
            trackedEntry.kind === 'transparent'
              ? 'repeating-conic-gradient(#555 0 25%, #222 0 50%) 50% / 8px 8px'
              : trackedEntry.color,
        }"
      />
      追踪索引 <b class="mono">#{{ trackedEntry.index }}</b>
      （{{
        trackedEntry.kind === "transparent"
          ? "透明项"
          : trackedEntry.kind === "background"
            ? "背景项"
            : trackedEntry.color
      }}）覆盖
      <b class="mono">{{ palette.trackedCount.value }}</b> 个单元 · 点击退出追踪
    </div>
    <div class="preview-bottom">
      <span class="mono"
        ><i class="status-dot" />{{
          p.busy.value
            ? "生成中"
            : p.doc.grid?.revision === p.doc.revision
              ? "已同步"
              : "待重新生成"
        }}
        <span class="muted">/ {{ p.count.value }} 个字符</span>
        <span v-if="p.doc.grid?.palette" class="muted">
          / {{ p.doc.grid.palette.entries.length }} 色板
          ({{ p.doc.grid.palette.metrics.usedEntries }} 占用)</span
        ></span
      >
      <div class="zoom">
        <button
          aria-label="缩小"
          @click="p.zoom.value = Math.max(25, p.zoom.value - 25)"
        >
          <Minus :size="14" /></button
        ><span>{{ p.zoom.value }}%</span
        ><button
          aria-label="放大"
          @click="p.zoom.value = Math.min(200, p.zoom.value + 25)"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>
    <div class="workspace-note">
      <span>从像素，到字符，再到有限色板。</span
      ><small>点击预览中的颜色，追踪它覆盖的每一个单元。</small
      ><span class="note-symbol">{ Aa }</span>
    </div>
  </main>
</template>
