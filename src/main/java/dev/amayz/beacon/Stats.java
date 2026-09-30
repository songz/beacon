package dev.amayz.beacon;

import com.datastax.oss.driver.api.core.cql.Row;
import io.javalin.Javalin;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Read side of the sweeper: the last few epochs' counts, so the page can show the leader doing its job. */
final class Stats {
    private Stats() {}

    static final int EPOCHS_SHOWN = 8;

    static void routes(Javalin app) {
        app.get("/api/stats", ctx -> {
            long now = Epochs.current();
            List<Long> epochs = new ArrayList<>();
            for (long e = now - EPOCHS_SHOWN + 1; e <= now; e++) epochs.add(e);
            List<Map<String, Object>> rows = new ArrayList<>();
            for (Row row : Cassandra.session().execute("SELECT epoch, reports, swept_at, swept_by FROM beacon.stats WHERE epoch IN ?", epochs)) {
                rows.add(Map.of(
                        "epoch", row.getLong("epoch"),
                        "reports", row.getInt("reports"),
                        "sweptAt", String.valueOf(row.getInstant("swept_at")),
                        "sweptBy", String.valueOf(row.getString("swept_by"))));
            }
            ctx.json(Map.of("epoch", now, "leader", Leader.current(), "rows", rows));
        });
    }
}
