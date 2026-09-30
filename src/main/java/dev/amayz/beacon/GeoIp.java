package dev.amayz.beacon;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * City-level location for an IP, from ip-api.com (free, no key, 45 requests a minute). Cached per IP so a
 * finder hammering the button does not hammer them. Private addresses resolve to the server's own city.
 */
final class GeoIp {
    private GeoIp() {}

    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Map<String, Map<String, Object>> CACHE = new ConcurrentHashMap<>();
    private static final int CACHE_LIMIT = 10_000;

    static Map<String, Object> lookup(String rawIp) {
        String ip = rawIp == null ? "" : rawIp.replace("[", "").replace("]", "").trim();
        String key = isPrivate(ip) ? "" : ip;
        Map<String, Object> hit = CACHE.get(key);
        if (hit != null) return hit;
        Map<String, Object> answer = fetch(key);
        if (CACHE.size() > CACHE_LIMIT) CACHE.clear();
        CACHE.put(key, answer);
        return answer;
    }

    private static Map<String, Object> fetch(String ip) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", "ip");
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create("http://ip-api.com/json/" + ip + "?fields=status,city,regionName,country,lat,lon"))
                    .timeout(Duration.ofSeconds(4)).GET().build();
            HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode node = JSON.readTree(res.body());
            if (res.statusCode() == 200 && "success".equals(node.path("status").asText())) {
                out.put("city", node.path("city").asText());
                out.put("region", node.path("regionName").asText());
                out.put("country", node.path("country").asText());
                out.put("lat", node.path("lat").asDouble());
                out.put("lon", node.path("lon").asDouble());
                return out;
            }
            System.out.printf("[GeoIp] no answer for ip=%s status=%d body=%s%n", ip, res.statusCode(), node.path("message").asText());
        } catch (Exception e) {
            System.out.printf("[GeoIp] lookup failed ip=%s err=%s%n", ip, e);
        }
        out.put("city", "somewhere");
        out.put("region", "");
        out.put("country", "");
        return out;
    }

    static boolean isPrivate(String ip) {
        if (ip == null || ip.isBlank()) return true;
        if (ip.contains(":")) { // IPv6: loopback, unique local, link local
            String lower = ip.toLowerCase();
            return lower.equals("::1") || lower.startsWith("0:0:0:0:0:0:0:1") || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
        }
        return ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("127.") || ip.matches("^172\\.(1[6-9]|2\\d|3[01])\\..*");
    }
}
