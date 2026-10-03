import java.net.HttpURLConnection;
import java.net.URI;

// Docker HEALTHCHECK probe. The hardened runtime image has no shell or curl,
// so the check runs on the JVM that is already there. Any exception (e.g.
// connection refused while the app is starting) exits non-zero = unhealthy.
public class HealthCheck {

    public static void main(String[] args) throws Exception {
        var connection = (HttpURLConnection) URI.create("http://localhost:8000/actuator/health")
                .toURL()
                .openConnection();
        connection.setConnectTimeout(2000);
        connection.setReadTimeout(3000);
        System.exit(connection.getResponseCode() == 200 ? 0 : 1);
    }
}
