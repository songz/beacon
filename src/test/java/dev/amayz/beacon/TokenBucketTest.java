package dev.amayz.beacon;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TokenBucketTest {

    @Test
    void tenThenBlockedThenOnePerSecond() {
        AtomicLong clock = new AtomicLong(0);
        TokenBucket bucket = new TokenBucket(10, 1.0, clock::get);

        for (int i = 0; i < 10; i++) assertTrue(bucket.tryAcquire(), "token " + (i + 1));
        assertFalse(bucket.tryAcquire(), "11th request in the same instant");
        assertEquals(1, bucket.secondsUntilNextToken());

        clock.addAndGet(500_000_000L); // half a second: still empty, Retry-After rounds up to 1
        assertFalse(bucket.tryAcquire());
        assertEquals(1, bucket.secondsUntilNextToken());

        clock.addAndGet(500_000_000L); // one full second since the burst: exactly one token back
        assertTrue(bucket.tryAcquire());
        assertFalse(bucket.tryAcquire());

        clock.addAndGet(60_000_000_000L); // a minute idle: back to capacity, never above it
        assertEquals(10.0, bucket.tokens(), 1e-9);
    }
}
