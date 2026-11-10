namespace Chime.Api.Endpoints;

public static class PingEndpoints {
  public static RouteGroupBuilder MapPingEndpoints(this RouteGroupBuilder api) {
    api.MapGet("/ping", () => TypedResults.Ok(new {message = "pong"}));
    return api;
  }
}
