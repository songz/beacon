package dev.amayz.beacon;

import com.datastax.oss.driver.api.core.CqlSession;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * The interview question, run against production code: release 64 threads at the same instant and count how
 * many distinct instances come back. One is the only acceptable answer.
 */
class SingletonTest {

    static final int THREADS = 64;

    /** Park every worker at a gate, open it, collect what each one got. Set membership is identity. */
    static <T> Set<T> hammer(Supplier<T> getInstance) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        CountDownLatch ready = new CountDownLatch(THREADS);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<T>> results = new ArrayList<>();
            for (int i = 0; i < THREADS; i++) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return getInstance.get();
                }));
            }
            ready.await();
            go.countDown();
            Set<T> distinct = ConcurrentHashMap.newKeySet();
            for (Future<T> f : results) distinct.add(f.get());
            return distinct;
        } finally {
            pool.shutdownNow();
        }
    }

    /** The production singleton: 64 threads ask for the CqlSession, exactly one connection is built. */
    @Test
    void cassandraSessionIsBuiltOnce() throws Exception {
        assumeTrue(cassandraReachable(), "needs the docker compose Cassandra on 127.0.0.1:9042");
        Set<CqlSession> sessions = hammer(Cassandra::session);
        assertEquals(1, sessions.size(), "distinct CqlSession instances");
        assertEquals(1, Cassandra.CONNECTS.get(), "connections built");
        Cassandra.session().close();
    }

    /** The same pattern with a cheap fake, so the test also runs where there is no Cassandra. */
    @Test
    void holderSingletonIsBuiltOnce() throws Exception {
        Set<HolderSingleton> seen = hammer(HolderSingleton::getInstance);
        assertEquals(1, seen.size());
        assertEquals(1, HolderSingleton.constructed.get());
    }

    /**
     * The bare null check from the commit before this one. Kept, disabled, so the failure is on record:
     * with this harness it produced 64, 64 and 63 distinct instances out of 64 threads in three runs
     * (Java 21.0.12, 8 cores, 2026-09-30). The 5 ms constructor stands in for real setup work and widens the window.
     * Enable it to watch it fail.
     */
    @Test
    @Disabled("measured 64, 64 and 63 distinct instances out of 64 threads in three runs on 2026-09-30 (Java 21.0.12, 8 cores); enable to reproduce")
    void naiveNullCheckIsNotASingleton() throws Exception {
        Set<NaiveSingleton> seen = hammer(NaiveSingleton::getInstance);
        assertEquals(1, seen.size(), "distinct instances from a bare null check");
    }

    static final class HolderSingleton {
        static final AtomicInteger constructed = new AtomicInteger();
        private HolderSingleton() { constructed.incrementAndGet(); pause(5); }
        private static final class Holder { static final HolderSingleton INSTANCE = new HolderSingleton(); }
        static HolderSingleton getInstance() { return Holder.INSTANCE; }
    }

    static final class NaiveSingleton {
        static final AtomicInteger constructed = new AtomicInteger();
        private static NaiveSingleton instance;
        private NaiveSingleton() { constructed.incrementAndGet(); pause(5); }
        static NaiveSingleton getInstance() {
            if (instance == null) instance = new NaiveSingleton();
            return instance;
        }
    }

    static void pause(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    static boolean cassandraReachable() {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(Main.env("CASSANDRA_HOST", "127.0.0.1"), Integer.parseInt(Main.env("CASSANDRA_PORT", "9042"))), 500);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
