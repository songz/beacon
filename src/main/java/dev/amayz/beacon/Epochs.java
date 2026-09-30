package dev.amayz.beacon;

/**
 * The item's key rotates once per epoch. Real Find My rotates every 15 minutes; the demo runs 60-second epochs
 * (EPOCH_SECONDS) so a visitor sees a rotation while watching. Epoch numbers are shared by owner, finder and server.
 */
final class Epochs {
    private Epochs() {}

    static final long SECONDS = Long.parseLong(Main.env("EPOCH_SECONDS", "60"));

    /** How many future epochs an owner publishes: 96 epochs is 24 hours of keys. */
    static final int PUBLISHED_AHEAD = 96;

    static long current() {
        return at(System.currentTimeMillis());
    }

    static long at(long epochMillis) {
        return epochMillis / 1000 / SECONDS;
    }
}
