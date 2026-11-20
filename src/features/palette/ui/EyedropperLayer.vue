<script setup lang="ts">
import { usePaletteSession, pickSourceColor } from "../model/usePaletteSession";
const p = usePaletteSession();

function pick(e: MouseEvent) {
  const doc = p.doc;
  if (!p.eyedropper.value || !doc.asset) return;
  // 阻止事件冒泡到裁剪面板，避免触发框选手势与重新生成
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  // 吸色点按裁剪区映射回原图坐标
  const fullX = doc.crop.x + nx * doc.crop.width;
  const fullY = doc.crop.y + ny * doc.crop.height;
  const hex = pickSourceColor(doc.asset.image, fullX, fullY);
  p.addLock(hex, "eyedropper");
  p.eyedropper.value = false;
}
</script>

<template>
  <div
    v-if="p.eyedropper.value && p.doc.asset"
    class="eyedropper-layer"
    @pointerdown.stop
    @pointermove.stop
    @pointerup.stop
    @click="pick"
    aria-label="吸色层，点击吸取颜色"
  >
    <span>点击吸取颜色</span>
  </div>
</template>
