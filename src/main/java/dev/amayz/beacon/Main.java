package dev.amayz.beacon;

import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Entry point: HTTP server, static pages, and the API routes. Business logic lives in the other classes. */
public final class Main {

    public static void main(String[] args) throws Exception {
        System.setProperty("org.slf4j.simpleLogger.defaultLogLevel", "warn"); // our [Tag] lines are the log
        int port = Integer.parseInt(env("PORT", "8080"));
        String replica = env("REPLICA_ID", "A");
        Log.replica = replica;

        Javalin app = Javalin.create(config -> {
            config.showJavalinBanner = false;
            config.useVirtualThreads = true; // Jetty handles each request on a virtual thread: a blocked fetch parks, it does not pin a pool thread
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
                "epoch", Epochs.current(),
                "epochSeconds", Epochs.SECONDS,
                "cassandraSessions", Cassandra.CONNECTS.get(),
                "leader", Leader.current(),
                "isLeader", Leader.isLeader(),
                "zookeeper", Zk.client().getZookeeperClient().isConnected() ? "connected" : "disconnected",
                "uptimeSeconds", java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime() / 1000
        )));

        Api.routes(app, new CassandraStore());
        Stats.routes(app);
        LogStream.routes(app);
        Chaos.routes(app, replica);

        Leader.start(replica);
        Sweeper.start(replica);

        app.start("0.0.0.0", port);
        Log.out("[Main] replica=%s listening on :%d", replica, port);

        // pm2 stop sends SIGINT; run.sh execs the JVM so it lands here. Release the latch first: a graceful
        // stop hands leadership over in well under a second, a kill -9 waits for the ZooKeeper session timeout.
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            Log.out("[Main] replica=%s shutting down", replica);
            Leader.stop();
            Zk.client().close();
            app.stop();
        }, "shutdown"));
    }

    static String env(String name, String fallback) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? fallback : v;
    }
}
