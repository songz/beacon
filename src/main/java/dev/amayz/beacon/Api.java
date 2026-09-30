package dev.amayz.beacon;

import com.fasterxml.jackson.databind.JsonNode;
import io.javalin.Javalin;
import io.javalin.http.BadRequestResponse;
import io.javalin.http.Context;

import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The JSON API. The server validates shapes and sizes only: a public key is 65 bytes that start with 0x04,
 * a ciphertext is between 93 and 2048 bytes. It never looks inside either.
 */
final class Api {
    private Api() {}

    /** 22 base64url characters: 16 bytes derived from the seed in the owner's browser. */
    static final Pattern SHARE_ID = Pattern.compile("^[A-Za-z0-9_-]{22}$");
    /** 43 base64url characters: a 32-byte SHA-256. */
    static final Pattern KEY_HASH = Pattern.compile("^[A-Za-z0-9_-]{43}$");

    static final int MAX_KEYS_PER_PUBLISH = Epochs.PUBLISHED_AHEAD + 2;
    static final int MAX_HASHES_PER_FETCH = Epochs.PUBLISHED_AHEAD + 2;
    /** ephemeral public key (65) + GCM nonce (12) + GCM tag (16): the smallest possible envelope. */
    static final int MIN_CIPHERTEXT = 93;
    static final int MAX_CIPHERTEXT = 2048;

    static void routes(Javalin app, Store store) {
        app.post("/api/schedules/{shareId}", ctx -> publish(ctx, store));
        app.get("/api/schedules/{shareId}/current", ctx -> current(ctx, store));
        app.before("/api/reports", ctx -> { if (ctx.method() == io.javalin.http.HandlerType.POST) RateLimit.check(ctx); });
        app.post("/api/reports", ctx -> report(ctx, store));
        app.get("/api/reports", ctx -> fetch(ctx, store));
        app.get("/api/whereami", Api::whereami);
    }

    static String shareId(Context ctx) {
        String id = ctx.pathParam("shareId");
        if (!SHARE_ID.matcher(id).matches()) throw new BadRequestResponse("share id must be 22 base64url characters");
        return id;
    }

    /** Owner publishes the public key for each of the next epochs. Idempotent; called every 15 minutes while the tab is open. */
    private static void publish(Context ctx, Store store) {
        String shareId = shareId(ctx);
        JsonNode body = ctx.bodyAsClass(JsonNode.class);
        JsonNode keys = body.path("keys");
        if (!keys.isArray() || keys.isEmpty() || keys.size() > MAX_KEYS_PER_PUBLISH) {
            throw new BadRequestResponse("keys must be 1.." + MAX_KEYS_PER_PUBLISH + " entries");
        }
        long now = Epochs.current();
        List<Store.PublishedKey> parsed = new ArrayList<>();
        for (JsonNode k : keys) {
            long epoch = k.path("epoch").asLong(-1);
            if (epoch < now - 1 || epoch > now + Epochs.PUBLISHED_AHEAD + 1) {
                throw new BadRequestResponse("epoch " + epoch + " is outside the publishable window around " + now);
            }
            byte[] pub = decode(k.path("publicKey").asText(""), "publicKey");
            if (pub.length != 65 || pub[0] != 0x04) throw new BadRequestResponse("publicKey must be a 65-byte uncompressed P-256 point");
            parsed.add(new Store.PublishedKey(epoch, pub));
        }
        store.putSchedule(shareId, parsed);
        Log.out("[Schedule] share=%s keys=%d epochs=%d..%d", shareId, parsed.size(),
                parsed.get(0).epoch(), parsed.get(parsed.size() - 1).epoch());
        ctx.status(201).json(Map.of("shareId", shareId, "stored", parsed.size(), "epoch", now));
    }

    /** Finder asks for the key of the current epoch. The answer is a public key: safe to hand to anyone. */
    private static void current(Context ctx, Store store) {
        String shareId = shareId(ctx);
        long epoch = Epochs.current();
        var key = store.keyFor(shareId, epoch);
        if (key.isEmpty()) {
            ctx.status(404).json(Map.of("error", "no key published for this share id and epoch", "epoch", epoch));
            return;
        }
        ctx.json(Map.of(
                "shareId", shareId,
                "epoch", epoch,
                "epochSeconds", Epochs.SECONDS,
                "publicKey", encode(key.get().publicKey())
        ));
    }

    /** Finder posts an opaque envelope under the hash of the key it encrypted to. */
    private static void report(Context ctx, Store store) {
        JsonNode body = ctx.bodyAsClass(JsonNode.class);
        String keyHash = body.path("keyHash").asText("");
        if (!KEY_HASH.matcher(keyHash).matches()) throw new BadRequestResponse("keyHash must be a base64url SHA-256");
        byte[] ciphertext = decode(body.path("ciphertext").asText(""), "ciphertext");
        if (ciphertext.length < MIN_CIPHERTEXT || ciphertext.length > MAX_CIPHERTEXT) {
            throw new BadRequestResponse("ciphertext must be " + MIN_CIPHERTEXT + ".." + MAX_CIPHERTEXT + " bytes");
        }
        store.putReport(decode(keyHash, "keyHash"), ciphertext);
        Log.out("[Report] keyHash=%s bytes=%d finder=%s ip=%s", keyHash.substring(0, 8), ciphertext.length,
                RateLimit.finderId(ctx).substring(0, 8), clientIp(ctx));
        ctx.status(201).json(Map.of("stored", true, "bytes", ciphertext.length));
    }

    /** Owner fetches by key hash, one hash per epoch it wants to check. */
    private static void fetch(Context ctx, Store store) {
        List<String> hashes = ctx.queryParams("h");
        if (hashes.isEmpty() || hashes.size() > MAX_HASHES_PER_FETCH) {
            throw new BadRequestResponse("pass 1.." + MAX_HASHES_PER_FETCH + " h= parameters");
        }
        for (String h : hashes) if (!KEY_HASH.matcher(h).matches()) throw new BadRequestResponse("bad key hash " + h);
        long started = System.nanoTime();
        Map<String, List<Store.Report>> found = store.reports(hashes);
        Map<String, List<Map<String, String>>> out = new HashMap<>();
        int total = 0;
        for (var e : found.entrySet()) {
            List<Map<String, String>> list = new ArrayList<>();
            for (Store.Report r : e.getValue()) list.add(Map.of("ts", r.ts(), "ciphertext", encode(r.ciphertext())));
            out.put(e.getKey(), list);
            total += list.size();
        }
        Log.out("[Fetch] hashes=%d reports=%d ms=%d thread=%s", hashes.size(), total,
                (System.nanoTime() - started) / 1_000_000, Thread.currentThread().isVirtual() ? "virtual" : "platform");
        ctx.json(out);
    }

    /** Coarse location from the caller's IP, for finders who decline browser geolocation. */
    private static void whereami(Context ctx) {
        ctx.json(GeoIp.lookup(clientIp(ctx)));
    }

    static String clientIp(Context ctx) {
        String forwarded = ctx.header("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].trim();
        return ctx.ip();
    }

    static byte[] decode(String b64url, String field) {
        try {
            return Base64.getUrlDecoder().decode(b64url);
        } catch (IllegalArgumentException e) {
            throw new BadRequestResponse(field + " must be base64url");
        }
    }

    static String encode(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
