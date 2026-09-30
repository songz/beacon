package dev.amayz.beacon;

/**
 * One println per event. printf writes its pieces separately, and pm2 timestamps each write, so a formatted
 * line came out split across two log lines. Formatting first keeps every event on one line.
 */
final class Log {
    private Log() {}

    static void out(String format, Object... args) {
        System.out.println(String.format(format, args));
    }
}
