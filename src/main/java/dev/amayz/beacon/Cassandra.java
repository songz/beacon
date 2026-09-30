package dev.amayz.beacon;

import com.datastax.oss.driver.api.core.CqlSession;
import com.datastax.oss.driver.api.core.config.DefaultDriverOption;
import com.datastax.oss.driver.api.core.config.DriverConfigLoader;

import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * One CqlSession per process. A session owns a connection pool and its own threads, so building two of them
 * is a real resource bug, not a style problem.
 */
final class Cassandra {
    private Cassandra() {}

    /** How many sessions this process has built. Anything above one is a bug. */
    static final AtomicInteger CONNECTS = new AtomicInteger();

    /**
     * Initialization-on-demand holder. The JVM initializes a class exactly once, under its own lock, the first
     * time something touches it. Holder is not touched until session() runs, so the session is lazy, and no
     * caller after the first ever takes a lock. SingletonTest hits this from 64 threads at once.
     */
    private static final class Holder {
        static final CqlSession INSTANCE = connect();
    }

    static CqlSession session() {
        return Holder.INSTANCE;
    }

    static CqlSession connect() {
        String host = Main.env("CASSANDRA_HOST", "127.0.0.1");
        int port = Integer.parseInt(Main.env("CASSANDRA_PORT", "9042"));
        CONNECTS.incrementAndGet();
        Log.out("[Cassandra] connecting to %s:%d", host, port);
        DriverConfigLoader config = DriverConfigLoader.programmaticBuilder()
                .withDuration(DefaultDriverOption.REQUEST_TIMEOUT, Duration.ofSeconds(10))
                .withString(DefaultDriverOption.REQUEST_CONSISTENCY, "LOCAL_QUORUM")
                .build();
        CqlSession bootstrap = CqlSession.builder()
                .addContactPoint(new InetSocketAddress(host, port))
                .withLocalDatacenter(Main.env("CASSANDRA_DC", "datacenter1"))
                .withConfigLoader(config)
                .build();
        applySchema(bootstrap);
        Log.out("[Cassandra] connected, schema applied");
        return bootstrap;
    }

    /** Runs schema.cql statement by statement. Every statement is IF NOT EXISTS, so every replica can run it at boot. */
    private static void applySchema(CqlSession s) {
        try {
            String cql = Files.isRegularFile(Path.of("schema.cql"))
                    ? Files.readString(Path.of("schema.cql"))
                    : Static.readResource("/schema.cql");
            String withoutComments = cql.lines().filter(l -> !l.trim().startsWith("--")).reduce("", (a, b) -> a + "\n" + b);
            Arrays.stream(withoutComments.split(";"))
                    .map(String::trim)
                    .filter(stmt -> !stmt.isEmpty())
                    .forEach(s::execute);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("cannot read schema.cql", e);
        }
    }
}
