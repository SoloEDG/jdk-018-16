<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import type { Grid } from "../../../shared/document";
import { drawGrid } from "../lib/draw";
const props = defineProps<{
  grid: Grid;
  color: boolean;
  background: string;
  zoom: number;
  trackId?: number | null;
}>();
const emit = defineEmits<{
  (e: "cell-click", payload: { cellIndex: number; paletteId: number }): void;
}>();
const canvas = ref<HTMLCanvasElement>();
function draw() {
  if (canvas.value)
    drawGrid(canvas.value, props.grid, props.color, props.background, {
      trackId: props.trackId ?? null,
    });
}
onMounted(draw);
watch(() => [props.grid, props.color, props.background, props.trackId], draw);

function onClick(e: MouseEvent) {
  const el = canvas.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const col = Math.floor(
    ((e.clientX - rect.left) / rect.width) * props.grid.columns,
  );
  const row = Math.floor(
    ((e.clientY - rect.top) / rect.height) * props.grid.rows,
  );
  if (col < 0 || row < 0 || col >= props.grid.columns || row >= props.grid.rows)
    return;
  const idx = row * props.grid.columns + col;
  emit("cell-click", {
    cellIndex: idx,
    paletteId: props.grid.cells[idx]!.paletteId,
  });
}
</script>
<template>
  <canvas
    ref="canvas"
    aria-label="字符画预览"
    class="art-canvas"
    :style="{
      width: (grid.columns * 8 * zoom) / 100 + 'px',
      height: (grid.rows * 16 * zoom) / 100 + 'px',
    }"
    @click="onClick"
  />
</template>
