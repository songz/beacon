package dev.amayz.beacon;

import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Entry point: HTTP server, static pages, and the API routes. Business logic lives in the other classes. */
public final class Main {

    public static void main(String[] args) {
        int port = Integer.parseInt(env("PORT", "8080"));
        String replica = env("REPLICA_ID", "A");

        Javalin app = Javalin.create(config -> {
            config.showJavalinBanner = false;
            config.http.defaultContentType = "application/json";
            // Serve web/ from disk when running from the checkout, from the jar otherwise.
            if (Files.isDirectory(Path.of("web"))) {
                config.staticFiles.add("web", Location.EXTERNAL);
            } else {
                config.staticFiles.add("/web", Location.CLASSPATH);
            }
            config.router.mount(router -> {
                router.after(ctx -> ctx.header("X-Beacon-Replica", replica));
            });
        });

        app.get("/health", ctx -> ctx.json(Map.of(
                "ok", true,
                "replica", replica,
                "uptimeSeconds", java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime() / 1000
        )));

        // The finder page is one static file behind any share id; the id is read from the URL in the browser.
        app.get("/f/{shareId}", ctx -> ctx.contentType("text/html").result(Static.finderPage()));

        Shares.routes(app);

        app.start("0.0.0.0", port);
        System.out.printf("[Main] replica=%s listening on :%d%n", replica, port);
    }

    static String env(String name, String fallback) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? fallback : v;
    }
}
