package dev.amayz.beacon;

import org.apache.curator.framework.recipes.leader.LeaderLatch;
import org.apache.curator.framework.recipes.leader.LeaderLatchListener;

/**
 * Leader election with Curator's LeaderLatch on /beacon/leader. Every replica registers an ephemeral
 * sequential node; the lowest one is leader. When a replica's ZooKeeper session ends (crash, pm2 stop, a
 * long GC pause past the session timeout) its node vanishes and the next one takes over within seconds.
 */
final class Leader {
    private Leader() {}

    static final String PATH = "/leader";

    private static volatile LeaderLatch latch;

    static void start(String replicaId) throws Exception {
        LeaderLatch l = new LeaderLatch(Zk.client(), PATH, replicaId);
        l.addListener(new LeaderLatchListener() {
            @Override public void isLeader() { Log.out("[Leader] acquired by replica %s", replicaId); }
            @Override public void notLeader() { Log.out("[Leader] lost by replica %s", replicaId); }
        });
        l.start();
        latch = l;
        Log.out("[Leader] replica %s joined the election at %s", replicaId, PATH);
    }

    /** Close the latch on shutdown so the ephemeral node vanishes now, not when the session times out. */
    static void stop() {
        LeaderLatch l = latch;
        if (l == null) return;
        try {
            l.close();
            System.out.println("[Leader] latch released on shutdown");
        } catch (Exception e) {
            Log.out("[Leader] close failed: %s", e);
        }
    }

    static boolean isLeader() {
        LeaderLatch l = latch;
        return l != null && l.hasLeadership();
    }

    /** The current leader's replica id, or "?" when the election has no answer yet. */
    static String current() {
        LeaderLatch l = latch;
        if (l == null) return "?";
        try {
            String id = l.getLeader().getId();
            return id == null || id.isBlank() ? "?" : id;
        } catch (Exception e) {
            return "?";
        }
    }
}
