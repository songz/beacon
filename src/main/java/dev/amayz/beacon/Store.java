package dev.amayz.beacon;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** What the server keeps: public keys per (share id, epoch) and ciphertexts per public-key hash. Nothing else. */
interface Store {

    record PublishedKey(long epoch, byte[] publicKey) {}

    record Report(String ts, byte[] ciphertext) {}

    void putSchedule(String shareId, List<PublishedKey> keys);

    Optional<PublishedKey> keyFor(String shareId, long epoch);

    void putReport(byte[] keyHash, byte[] ciphertext);

    /** Reports for each hash, newest first. Keys are the base64url hash the caller asked with. */
    Map<String, List<Report>> reports(List<String> keyHashes);
}
