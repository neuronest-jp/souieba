import { createApp } from "vue";
import App from "./App.vue";
import { setupNative } from "./native";
import { applyTimeOfDay } from "./season";
import "./style.css";

// 最初の描画から時間帯の地の紙になるよう、mount より前に付ける（ADR-0011 第 9 節）
applyTimeOfDay();
void setupNative();
createApp(App).mount("#app");
