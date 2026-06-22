import { defineConfig, type Plugin } from "vite";
import { shouldRedirectSourceNavigation } from "./src/dev/sourceRouteGuard";

function sourceNavigationGuard(): Plugin {
  return {
    name: "edgeguard-source-navigation-guard",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!shouldRedirectSourceNavigation(req)) {
          next();
          return;
        }

        res.statusCode = 302;
        res.setHeader("Location", "/");
        res.end("Redirecting to Edgeguard Duel...");
      });
    },
  };
}

export default defineConfig({
  plugins: [sourceNavigationGuard()],
});
