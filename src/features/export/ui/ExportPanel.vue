<script setup lang="ts">
import { Download, Copy, ArrowUpRight } from "lucide-vue-next";
import { useExport } from "../model/useExport";
const e = useExport();
</script>
<template>
  <section class="export-bar">
    <div>
      <span class="eyebrow">READY TO SHARE</span>
      <h3>带走你的字符作品</h3>
      <small
        >文本保留完整字符布局；PNG 与预览共用同一色板，索引模式导出 PLTE
        索引色（含背景与透明项）。</small
      >
    </div>
    <div class="export-actions">
      <button class="secondary" :disabled="!e.ready()" @click="e.copy">
        <Copy :size="15" /> 复制字符</button
      ><button class="secondary" :disabled="!e.ready()" @click="e.png">
        PNG <ArrowUpRight :size="15" /></button
      ><button class="primary" :disabled="!e.ready()" @click="e.saveText">
        <Download :size="16" /> 导出 .TXT
      </button>
    </div>
  </section>
</template>
