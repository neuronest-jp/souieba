import { createApp } from "vue";
import App from "./App.vue";
import { setupNative } from "./native";
import "./style.css";

void setupNative();
createApp(App).mount("#app");
