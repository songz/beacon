package dev.amayz.beacon;

import io.javalin.http.Context;
import io.javalin.http.Cookie;
import io.javalin.http.SameSite;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Two buckets per report: one for the finder (a cookie minted on the finder page) and one for the IP. A
 * finder who clears cookies still shares the IP bucket; a NAT full of finders still gets their own cookies.
 * Capacity 10, refill 1 per second. In-process, so each replica counts on its own; the README says what
 * changes in a fleet.
 */
final class RateLimit {
    private RateLimit() {}

    static final int CAPACITY = 10;
    static final double REFILL_PER_SECOND = 1.0;
    static final String COOKIE = "beacon_finder";
    private static final int MAX_BUCKETS = 50_000;

    private static final Map<String, TokenBucket> BUCKETS = new ConcurrentHashMap<>();
    private static final SecureRandom RANDOM = new SecureRandom();

    /** Give the finder page a finder id if it has none. HttpOnly, so the page's own JS never sees it. */
    static String finderId(Context ctx) {
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

    /** Runs before POST /api/reports. Ends the request with 429 and Retry-After when either bucket is empty. */
    static void check(Context ctx) {
        String finder = finderId(ctx);
        String ip = Api.clientIp(ctx);
        TokenBucket byFinder = bucket("finder:" + finder);
        TokenBucket byIp = bucket("ip:" + ip);
        // Ask the IP bucket first so a rejected finder does not also burn an IP token, and vice versa.
        long retryAfter = Math.max(byFinder.secondsUntilNextToken(), byIp.secondsUntilNextToken());
        if (retryAfter > 0 || !byFinder.tryAcquire() || !byIp.tryAcquire()) {
            retryAfter = Math.max(1, Math.max(byFinder.secondsUntilNextToken(), byIp.secondsUntilNextToken()));
            Log.out("[RateLimit] 429 finder=%s ip=%s retryAfter=%ds finderTokens=%.1f ipTokens=%.1f",
                    finder.substring(0, 8), ip, retryAfter, byFinder.tokens(), byIp.tokens());
            ctx.status(429).header("Retry-After", Long.toString(retryAfter))
               .json(Map.of("error", "rate limited", "retryAfterSeconds", retryAfter));
            ctx.skipRemainingHandlers();
        }
    }

    private static TokenBucket bucket(String key) {
        if (BUCKETS.size() > MAX_BUCKETS) {
            // Crude but bounded: drop buckets that are full again, they carry no information.
            BUCKETS.entrySet().removeIf(e -> e.getValue().tokens() >= CAPACITY);
        }
        return BUCKETS.computeIfAbsent(key, k -> new TokenBucket(CAPACITY, REFILL_PER_SECOND));
    }
}
