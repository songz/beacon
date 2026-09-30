package dev.amayz.beacon;

import org.apache.curator.framework.CuratorFramework;
import org.apache.curator.framework.CuratorFrameworkFactory;
import org.apache.curator.retry.ExponentialBackoffRetry;

/** One CuratorFramework per process, the same holder pattern as Cassandra. It owns the ZooKeeper session. */
final class Zk {
    private Zk() {}

    private static final class Holder {
        static final CuratorFramework INSTANCE = connect();
    }

    static CuratorFramework client() {
        return Holder.INSTANCE;
    }

    private static CuratorFramework connect() {
        String connect = Main.env("ZK_CONNECT", "127.0.0.1:2181");
        Log.out("[Zk] connecting to %s", connect);
        CuratorFramework client = CuratorFrameworkFactory.builder()
                .connectString(connect)
                .sessionTimeoutMs(6_000)
                .connectionTimeoutMs(5_000)
                .retryPolicy(new ExponentialBackoffRetry(500, 5))
                .namespace("beacon")
                .build();
        client.start();
        return client;
    }
}
