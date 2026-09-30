package dev.amayz.beacon;

import java.util.function.LongSupplier;

/**
 * Token bucket: capacity tokens, refilled at a steady rate, refilled lazily on each call instead of by a timer.
 * One synchronized method is the whole concurrency story: the bucket is per finder, so contention is
 * one finder's own requests, and the critical section is a handful of arithmetic ops.
 */
final class TokenBucket {

    private final double capacity;
    private final double refillPerSecond;
    private final LongSupplier nanoClock;

    private double tokens;
    private long lastRefillNanos;

    TokenBucket(int capacity, double refillPerSecond) {
        this(capacity, refillPerSecond, System::nanoTime);
    }

    TokenBucket(int capacity, double refillPerSecond, LongSupplier nanoClock) {
        this.capacity = capacity;
        this.refillPerSecond = refillPerSecond;
        this.nanoClock = nanoClock;
        this.tokens = capacity;
        this.lastRefillNanos = nanoClock.getAsLong();
    }

    /** Take one token if there is one. */
    synchronized boolean tryAcquire() {
        refill();
        if (tokens >= 1) {
            tokens -= 1;
            return true;
        }
        return false;
    }

    /** Whole seconds until the next token exists: the Retry-After header. */
    synchronized long secondsUntilNextToken() {
        refill();
        if (tokens >= 1) return 0;
        return (long) Math.ceil((1 - tokens) / refillPerSecond);
    }

    synchronized boolean isFull() {
        refill();
        return tokens >= capacity;
    }

    synchronized double tokens() {
        refill();
        return tokens;
    }

    /** Lazy refill: credit the time elapsed since the last call. No timer thread per bucket. */
    private void refill() {
        long now = nanoClock.getAsLong();
        double elapsedSeconds = (now - lastRefillNanos) / 1_000_000_000.0;
        if (elapsedSeconds > 0) {
            tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
            lastRefillNanos = now;
        }
    }
}
