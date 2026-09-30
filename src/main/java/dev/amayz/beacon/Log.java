package dev.amayz.beacon;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * One println per event, and the same line handed to every SSE subscriber. printf writes its pieces
 * separately, and pm2 timestamps each write, so a formatted line came out split across two log lines.
 * Formatting first keeps every event on one line.
 */
final class Log {
    private Log() {}

    static volatile String replica = "?";

    private static final int KEEP = 200;
    private static final Deque<String> RECENT = new ArrayDeque<>();
    private static final List<Consumer<String>> SUBSCRIBERS = new CopyOnWriteArrayList<>();

    static void out(String format, Object... args) {
        String line = String.format(format, args);
        System.out.println(line);
        String tagged = replica + " " + line;
        synchronized (RECENT) {
            RECENT.addLast(tagged);
            if (RECENT.size() > KEEP) RECENT.removeFirst();
        }
        for (Consumer<String> s : SUBSCRIBERS) {
            try { s.accept(tagged); } catch (RuntimeException e) { SUBSCRIBERS.remove(s); }
        }
    }

    static List<String> recent() {
        synchronized (RECENT) { return new ArrayList<>(RECENT); }
    }

    static void subscribe(Consumer<String> s) { SUBSCRIBERS.add(s); }

    static void unsubscribe(Consumer<String> s) { SUBSCRIBERS.remove(s); }

    static int subscribers() { return SUBSCRIBERS.size(); }
}
