package dev.amayz.beacon;

import io.javalin.http.Context;
import io.javalin.http.Cookie;
import io.javalin.http.SameSite;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Two buckets per report. The finder bucket (capacity 10, refill 1 per second) is the demo: a finder is the
 * X-Beacon-Finder header the page sends per sprite, or a cookie the server mints when there is none. The IP
 * bucket (capacity 100, refill 20 per second) is a coarse backstop for a whole browser or NAT, wide enough
 * that one spammy finder cannot starve the five well-behaved ones next to it. In-process, so each replica
 * counts on its own; the README says what changes in a fleet.
 */
final class RateLimit {
    private RateLimit() {}

    static final int CAPACITY = 10;
    static final double REFILL_PER_SECOND = 1.0;
    static final int IP_CAPACITY = 100;
    static final double IP_REFILL_PER_SECOND = 20.0;
    static final String COOKIE = "beacon_finder";
    static final String HEADER = "X-Beacon-Finder";
    /** Optional display name the page sends per sprite ("finder 5"), for the log only. */
    static final String NAME_HEADER = "X-Beacon-Finder-Name";
    private static final int MAX_BUCKETS = 50_000;

    private static final Map<String, TokenBucket> BUCKETS = new ConcurrentHashMap<>();
    private static final SecureRandom RANDOM = new SecureRandom();

    /** The finder id: the header the page sends per sprite, else a cookie, minted here when there is none. */
    static String finderId(Context ctx) {
        String header = ctx.header(HEADER);
        if (header != null && header.matches("^[A-Za-z0-9_-]{22}$")) return header;
        String id = ctx.cookie(COOKIE);
        if (id == null || !id.matches("^[A-Za-z0-9_-]{22}$")) {
            byte[] bytes = new byte[16];
            RANDOM.nextBytes(bytes);
            id = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            Cookie cookie = new Cookie(COOKIE, id);
            cookie.setHttpOnly(true);
            cookie.setSameSite(SameSite.LAX);
            cookie.setPath("/");
            cookie.setMaxAge(60 * 60 * 24 * 30);
            ctx.cookie(cookie);
        }
        return id;
    }

    /** "finder 5 (uVWWk-Lp)" when the page named the sprite, else the short id. Never trusted for anything but the log. */
    static String finderName(Context ctx) {
        String id = finderId(ctx).substring(0, 8);
        String name = ctx.header(NAME_HEADER);
        if (name != null && name.matches("^[A-Za-z0-9 _-]{1,24}$")) return name + " (" + id + ")";
        return "finder " + id;
    }

    /** Runs before POST /api/reports. Ends the request with 429 and Retry-After when either bucket is empty. */
    static void check(Context ctx) {
        String finder = finderId(ctx);
        String ip = Api.clientIp(ctx);
        TokenBucket byFinder = bucket("finder:" + finder, CAPACITY, REFILL_PER_SECOND);
        TokenBucket byIp = bucket("ip:" + ip, IP_CAPACITY, IP_REFILL_PER_SECOND);
        // Ask the IP bucket first so a rejected finder does not also burn an IP token, and vice versa.
        long retryAfter = Math.max(byFinder.secondsUntilNextToken(), byIp.secondsUntilNextToken());
        if (retryAfter > 0 || !byFinder.tryAcquire() || !byIp.tryAcquire()) {
            retryAfter = Math.max(1, Math.max(byFinder.secondsUntilNextToken(), byIp.secondsUntilNextToken()));
            logRejection(finder, finderName(ctx), ip, retryAfter, byFinder, byIp);
            ctx.status(429).header("Retry-After", Long.toString(retryAfter))
               .json(Map.of("error", "rate limited", "retryAfterSeconds", retryAfter));
            ctx.skipRemainingHandlers();
        }
    }

    /** A spammy finder is rejected 20 times a second; log once a second per finder with the count, so the log stays readable. */
    private static final Map<String, long[]> REJECTIONS = new ConcurrentHashMap<>(); // finder -> {secondLogged, suppressed}

    private static void logRejection(String finder, String name, String ip, long retryAfter, TokenBucket byFinder, TokenBucket byIp) {
        long second = System.currentTimeMillis() / 1000;
        long[] state = REJECTIONS.computeIfAbsent(finder, k -> new long[]{0, 0});
        synchronized (state) {
            if (state[0] == second) { state[1]++; return; }
            long suppressed = state[1];
            state[0] = second;
            state[1] = 0;
            Log.out("[RateLimit] %s throttled · %.1f/%d tokens, ip %.0f/%d · 429 retry in %d s%s",
                    name, byFinder.tokens(), CAPACITY, byIp.tokens(), IP_CAPACITY, retryAfter,
                    suppressed > 0 ? " (+" + suppressed + " more 429s this second)" : "");
        }
        if (REJECTIONS.size() > MAX_BUCKETS) REJECTIONS.clear();
    }

    private static TokenBucket bucket(String key, int capacity, double refillPerSecond) {
        if (BUCKETS.size() > MAX_BUCKETS) {
            // Crude but bounded: drop buckets that are full again, they carry no information.
            BUCKETS.entrySet().removeIf(e -> e.getValue().isFull());
        }
        return BUCKETS.computeIfAbsent(key, k -> new TokenBucket(capacity, refillPerSecond));
    }
}
