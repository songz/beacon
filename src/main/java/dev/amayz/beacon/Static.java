package dev.amayz.beacon;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Reads a page out of web/ (disk in dev, classpath in the jar) so a route can serve it under a different URL. */
final class Static {
    private Static() {}

    static String finderPage() {
        return read("finder.html");
    }

    static String read(String name) {
        try {
            Path onDisk = Path.of("web", name);
            if (Files.isRegularFile(onDisk)) return Files.readString(onDisk);
        } catch (IOException e) {
            throw new IllegalStateException("cannot read web/" + name, e);
        }
        return readResource("/web/" + name);
    }

    static String readResource(String path) {
        try (InputStream in = Static.class.getResourceAsStream(path)) {
            if (in == null) throw new IllegalStateException("missing resource " + path);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("cannot read resource " + path, e);
        }
    }
}
