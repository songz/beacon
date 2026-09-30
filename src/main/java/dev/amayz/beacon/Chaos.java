package dev.amayz.beacon;

import io.javalin.Javalin;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * The failover demo. POST /api/chaos/kill-leader on the leader replica exits the process; pm2 restarts it
 * about 15 seconds later (JVM boot plus the Cassandra connect), and in the meantime the other replica
 * acquires the latch. One kill per 30 seconds across all visitors, so the pair can never be flapped down.
 */
final class Chaos {
    private Chaos() {}

    static final long COOLDOWN_MS = 30_000;
    private static final AtomicLong LAST_KILL = new AtomicLong();

    static void routes(Javalin app, String replica) {
        app.post("/api/chaos/kill-leader", ctx -> {
            if (!Leader.isLeader()) {
                ctx.status(409).json(Map.of("error", "this replica is not the leader", "replica", replica, "leader", Leader.current()));
                return;
            }
            long now = System.currentTimeMillis();
            long last = LAST_KILL.get();
            if (now - last < COOLDOWN_MS || !LAST_KILL.compareAndSet(last, now)) {
                long wait = (COOLDOWN_MS - (now - last)) / 1000 + 1;
                ctx.status(429).header("Retry-After", Long.toString(wait)).json(Map.of("error", "one kill per 30 s", "retryAfterSeconds", wait));
                return;
            }
            Log.out("[Chaos] leader %s exiting on request from %s; pm2 restarts it", replica, Api.clientIp(ctx));
            ctx.json(Map.of("killed", replica));
            Thread t = new Thread(() -> {
                try { Thread.sleep(300); } catch (InterruptedException ignored) { }
                System.exit(0);
            }, "chaos-exit");
            t.setDaemon(true);
            t.start();
        });
    }
}
