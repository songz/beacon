package dev.amayz.beacon;

/** The item's key rotates every 15 minutes. Epoch numbers are shared by the owner, the finder and the server. */
final class Epochs {
    private Epochs() {}

    static final long SECONDS = 900;

    /** How many future epochs an owner publishes: 96 epochs is 24 hours of keys. */
    static final int PUBLISHED_AHEAD = 96;

    static long current() {
        return at(System.currentTimeMillis());
    }

    static long at(long epochMillis) {
        return epochMillis / 1000 / SECONDS;
    }
}
