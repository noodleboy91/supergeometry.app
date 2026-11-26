import "./style.css";
import { App } from "./app";
import { syncFromRemote } from "./doc/library";
import { loadConfig } from "./doc/remote";
import { outerScrollbars } from "./ui/scrollbars";
import { installDebug } from "./debug";
import { keepPageSteady } from "./ui/steady";

// Update reloads with ?v=<time> so no stored copy is used; once loaded, the
// address is plain again (it's what people copy to share the app).
{
  const url = new URL(location.href);
  if (url.searchParams.has("v")) {
    url.searchParams.delete("v");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
}

// The page itself never scrolls (a phone pushing it along for a keyboard that does not come).
keepPageSteady();

// Scroll bars outside the windows, only while scrolling.
outerScrollbars();

// Storage mode is set at install time by /config.json. A plain static host has
// no config file and keeps the original browser-only behaviour.
void (async () => {
  await loadConfig();
  await syncFromRemote();
  const app = new App(document.getElementById("view") as HTMLCanvasElement);
  // Handy for debugging from the console.
  (window as unknown as { supergeometry: App }).supergeometry = app;
  // And sg: read and work the app from the console (sg.help()).
  installDebug(app);
})();
