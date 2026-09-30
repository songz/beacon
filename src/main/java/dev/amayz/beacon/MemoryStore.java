package dev.amayz.beacon;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/** In-memory store: enough to run the whole flow on one process. Cassandra replaces it in the next commit. */
final class MemoryStore implements Store {

    private final Map<String, Map<Long, byte[]>> schedules = new ConcurrentHashMap<>();
    private final Map<String, List<Report>> reports = new ConcurrentHashMap<>();

    @Override
    public void putSchedule(String shareId, List<PublishedKey> keys) {
        Map<Long, byte[]> byEpoch = schedules.computeIfAbsent(shareId, k -> new ConcurrentHashMap<>());
        for (PublishedKey key : keys) byEpoch.put(key.epoch(), key.publicKey());
    }

    @Override
    public Optional<PublishedKey> keyFor(String shareId, long epoch) {
        Map<Long, byte[]> byEpoch = schedules.get(shareId);
        if (byEpoch == null) return Optional.empty();
        byte[] pub = byEpoch.get(epoch);
        return pub == null ? Optional.empty() : Optional.of(new PublishedKey(epoch, pub));
    }

    @Override
    public void putReport(byte[] keyHash, byte[] ciphertext) {
        String key = Base64.getUrlEncoder().withoutPadding().encodeToString(keyHash);
        reports.computeIfAbsent(key, k -> new CopyOnWriteArrayList<>())
               .add(0, new Report(Instant.now().toString(), ciphertext));
    }

    @Override
    public Map<String, List<Report>> reports(List<String> keyHashes) {
        Map<String, List<Report>> out = new LinkedHashMap<>();
        for (String h : keyHashes) {
            List<Report> list = reports.get(h);
            if (list != null && !list.isEmpty()) out.put(h, new ArrayList<>(list));
        }
        return out;
    }
}
