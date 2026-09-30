package dev.amayz.beacon;

import com.datastax.oss.driver.api.core.CqlSession;
import com.datastax.oss.driver.api.core.cql.BatchStatement;
import com.datastax.oss.driver.api.core.cql.BatchType;
import com.datastax.oss.driver.api.core.cql.PreparedStatement;
import com.datastax.oss.driver.api.core.cql.Row;
import com.datastax.oss.driver.api.core.uuid.Uuids;

import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Cassandra-backed store. Every query hits exactly one partition, which is what makes Cassandra cheap:
 * the partition key (key_hash or share_id) picks the node, the clustering key (ts or epoch) orders rows inside it.
 */
final class CassandraStore implements Store {

    /** Newest reports per key hash that one fetch returns. */
    static final int REPORTS_PER_HASH = 50;

    private final PreparedStatement insertKey;
    private final PreparedStatement selectKey;
    private final PreparedStatement insertReport;
    private final PreparedStatement selectReports;

    CassandraStore() {
        CqlSession s = Cassandra.session();
        insertKey = s.prepare("INSERT INTO beacon.schedules (share_id, epoch, public_key) VALUES (?, ?, ?)");
        selectKey = s.prepare("SELECT public_key FROM beacon.schedules WHERE share_id = ? AND epoch = ?");
        insertReport = s.prepare("INSERT INTO beacon.reports (key_hash, ts, ciphertext) VALUES (?, ?, ?)");
        selectReports = s.prepare("SELECT ts, ciphertext FROM beacon.reports WHERE key_hash = ? LIMIT " + REPORTS_PER_HASH);
    }

    @Override
    public void putSchedule(String shareId, List<PublishedKey> keys) {
        // All rows share one partition (share_id), so an unlogged batch is one write to one node, not 97.
        BatchStatement batch = BatchStatement.newInstance(BatchType.UNLOGGED);
        for (PublishedKey key : keys) {
            batch = batch.add(insertKey.bind(shareId, key.epoch(), ByteBuffer.wrap(key.publicKey())));
        }
        Cassandra.session().execute(batch);
    }

    @Override
    public Optional<PublishedKey> keyFor(String shareId, long epoch) {
        Row row = Cassandra.session().execute(selectKey.bind(shareId, epoch)).one();
        if (row == null) return Optional.empty();
        return Optional.of(new PublishedKey(epoch, bytes(row.getByteBuffer("public_key"))));
    }

    @Override
    public void putReport(byte[] keyHash, byte[] ciphertext) {
        // The row's TTL comes from the table default (7 days). timeuuid gives newest-first order for free.
        Cassandra.session().execute(insertReport.bind(ByteBuffer.wrap(keyHash), Uuids.timeBased(), ByteBuffer.wrap(ciphertext)));
    }

    /**
     * One partition read per hash, all in flight at once. Virtual threads make blocking driver calls cheap
     * to park: 97 tasks, 97 virtual threads, a handful of carrier threads. invokeAll keeps the answer order
     * and rethrows the first failure. The executor is per call and closed by try-with-resources, so nothing
     * leaks across requests.
     */
    @Override
    public Map<String, List<Report>> reports(List<String> keyHashes) {
        List<Callable<List<Report>>> tasks = new ArrayList<>();
        for (String h : keyHashes) tasks.add(() -> reportsFor(h));
        Map<String, List<Report>> out = new LinkedHashMap<>();
        try (ExecutorService fanOut = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<List<Report>>> results = fanOut.invokeAll(tasks);
            for (int i = 0; i < keyHashes.size(); i++) {
                List<Report> list = results.get(i).get();
                if (!list.isEmpty()) out.put(keyHashes.get(i), list);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("fetch interrupted", e);
        } catch (java.util.concurrent.ExecutionException e) {
            throw new IllegalStateException("fetch failed: " + e.getCause(), e.getCause());
        }
        return out;
    }

    List<Report> reportsFor(String keyHash) {
        ByteBuffer hash = ByteBuffer.wrap(Base64.getUrlDecoder().decode(keyHash));
        List<Report> list = new ArrayList<>();
        for (Row row : Cassandra.session().execute(selectReports.bind(hash))) {
            Instant at = Instant.ofEpochMilli(Uuids.unixTimestamp(row.getUuid("ts")));
            list.add(new Report(at.toString(), bytes(row.getByteBuffer("ciphertext"))));
        }
        return list;
    }

    private static byte[] bytes(ByteBuffer buf) {
        byte[] out = new byte[buf.remaining()];
        buf.duplicate().get(out);
        return out;
    }
}
