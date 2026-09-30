package dev.amayz.beacon;

import com.datastax.oss.driver.api.core.CqlSession;
import com.datastax.oss.driver.api.core.cql.PreparedStatement;
import com.datastax.oss.driver.api.core.cql.Row;
import com.datastax.oss.driver.api.core.uuid.Uuids;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * The job that must run on exactly one replica: every 30 seconds, count reports per epoch into the stats
 * table. Both replicas tick; only the one holding the leader latch does the work. A full scan of reports is
 * fine at toy scale and is called out in the README as the thing that changes first in a fleet.
 */
final class Sweeper {
    private Sweeper() {}

    static final long PERIOD_SECONDS = 30;

    private static final ScheduledExecutorService TIMER = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sweeper");
        t.setDaemon(true);
        return t;
    });

    static void start(String replicaId) {
        TIMER.scheduleAtFixedRate(() -> tick(replicaId), 5, PERIOD_SECONDS, TimeUnit.SECONDS);
    }

    private static void tick(String replicaId) {
        try {
            if (!Leader.isLeader()) {
                Log.out("[Sweep] skipped on replica %s, leader is %s", replicaId, Leader.current());
                return;
            }
            long started = System.nanoTime();
            Map<Long, Integer> perEpoch = countPerEpoch();
            writeStats(perEpoch, replicaId);
            int total = perEpoch.values().stream().mapToInt(Integer::intValue).sum();
            Log.out("[Sweep] replica %s counted %d reports across %d epochs in %d ms",
                    replicaId, total, perEpoch.size(), (System.nanoTime() - started) / 1_000_000);
        } catch (Exception e) {
            Log.out("[Sweep] failed on replica %s: %s", replicaId, e);
        }
    }

    private static Map<Long, Integer> countPerEpoch() {
        Map<Long, Integer> perEpoch = new TreeMap<>();
        for (Row row : Cassandra.session().execute("SELECT ts FROM beacon.reports")) {
            long epoch = Epochs.at(Uuids.unixTimestamp(row.getUuid("ts")));
            perEpoch.merge(epoch, 1, Integer::sum);
        }
        return perEpoch;
    }

    private static final Map<CqlSession, PreparedStatement> UPSERT = new HashMap<>();

    private static void writeStats(Map<Long, Integer> perEpoch, String replicaId) {
        CqlSession s = Cassandra.session();
        PreparedStatement upsert = UPSERT.computeIfAbsent(s,
                k -> k.prepare("INSERT INTO beacon.stats (epoch, reports, swept_at, swept_by) VALUES (?, ?, ?, ?)"));
        Instant now = Instant.now();
        for (var e : perEpoch.entrySet()) s.execute(upsert.bind(e.getKey(), e.getValue(), now, replicaId));
    }
}
