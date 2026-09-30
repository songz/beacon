package dev.amayz.beacon;

import io.javalin.Javalin;
import io.javalin.http.sse.SseClient;

import java.util.function.Consumer;

/**
 * GET /api/log streams this replica's log lines as server-sent events. The page opens one stream per
 * replica (the forwarder routes ?replica=A|B), so it sees both sides of a failover. Each client parks
 * on a virtual thread; a closed browser tab unsubscribes it.
 */
final class LogStream {
    private LogStream() {}

    static void routes(Javalin app) {
        app.sse("/api/log", (SseClient client) -> {
            client.keepAlive();
            for (String line : Log.recent()) client.sendEvent("log", line);
            Consumer<String> push = line -> client.sendEvent("log", line);
            Log.subscribe(push);
            client.onClose(() -> Log.unsubscribe(push));
            Log.out("[Log] stream opened, subscribers=%d", Log.subscribers());
        });
    }
}
