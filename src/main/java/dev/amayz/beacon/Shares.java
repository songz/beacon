package dev.amayz.beacon;

import io.javalin.Javalin;
import io.javalin.http.Context;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * A share id names one lost item. The browser mints it; the server only remembers that it exists so the
 * finder page can tell a real link from a typo. In-memory for now.
 */
final class Shares {
    private Shares() {}

    /** 22 base64url characters: 16 random bytes, minted in the owner's browser. */
    static final Pattern SHARE_ID = Pattern.compile("^[A-Za-z0-9_-]{22}$");

    private static final Map<String, Instant> KNOWN = new ConcurrentHashMap<>();

    static void routes(Javalin app) {
        app.post("/api/shares/{shareId}", Shares::register);
        app.get("/api/shares/{shareId}", Shares::lookup);
    }

    static String shareId(Context ctx) {
        String id = ctx.pathParam("shareId");
        if (!SHARE_ID.matcher(id).matches()) {
            throw new io.javalin.http.BadRequestResponse("share id must be 22 base64url characters");
        }
        return id;
    }

    private static void register(Context ctx) {
        String id = shareId(ctx);
        Instant created = KNOWN.computeIfAbsent(id, k -> Instant.now());
        System.out.printf("[Share] registered share=%s%n", id);
        ctx.status(201).json(Map.of("shareId", id, "created", created.toString()));
    }

    private static void lookup(Context ctx) {
        String id = shareId(ctx);
        Instant created = KNOWN.get(id);
        if (created == null) {
            ctx.status(404).json(Map.of("error", "unknown share id"));
            return;
        }
        ctx.json(Map.of("shareId", id, "created", created.toString()));
    }
}
